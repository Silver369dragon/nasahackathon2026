"""Validate and append externally generated synthetic body scans in a caller transaction."""
import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Literal, get_args

from pydantic import AwareDatetime, Field, model_validator

from .body_scan import BodyScan, Finding, RegionCode, RegionReading, Totals
from .models import Contract, Identifier, utc_text
from .store import CREW, Data, Problem, encoded


class BodyImportScan(Contract):
    """An external scan has a source ID; receipt time and stored IDs are server owned."""

    id: Identifier
    crewId: Identifier
    schemaVersion: Literal['body-scan/1'] = 'body-scan/1'
    runId: None = None
    mode: Literal['training'] = 'training'
    synthetic: Literal[True] = True
    source: Literal['mock'] = 'mock'
    method: Literal['orbital-bioscan-v1'] = 'orbital-bioscan-v1'
    observedAt: AwareDatetime
    totals: Totals
    regions: dict[RegionCode, RegionReading]
    findings: list[Finding] = Field(max_length=200)

    @model_validator(mode='after')
    def validate_scan(self):
        if self.crewId not in CREW:
            raise ValueError('The scan must belong to a registered crew member')
        if self.observedAt > datetime.now(UTC):
            raise ValueError('A scan cannot be observed in the future')
        if set(self.regions) != set(get_args(RegionCode)):
            raise ValueError('All 22 regions are required; explicitly mark unavailable regions missing')
        if len({finding.id for finding in self.findings}) != len(self.findings):
            raise ValueError('Finding IDs must be unique within a scan')
        if any(finding.onsetAt > self.observedAt for finding in self.findings):
            raise ValueError('Finding onset cannot follow the scan observation')
        if not all(region.quality == 'good' for region in self.regions.values()):
            return self
        for field in ('muscleMassKg', 'fatMassKg'):
            total = getattr(self.totals, field)
            regional_sum = sum(getattr(region, field) for region in self.regions.values())
            if total is not None and abs(regional_sum - total) > max(0.05, total * 0.01):
                raise ValueError(f'Complete regional {field} must agree with totals within 1% or 0.05 kg')
        return self


class BodyImport(Contract):
    scans: list[BodyImportScan] = Field(min_length=1, max_length=5000)

    @model_validator(mode='after')
    def validate_ids(self):
        keys = {(scan.crewId, scan.id) for scan in self.scans}
        if len(keys) != len(self.scans):
            raise ValueError('Scan IDs must be unique per crew member within the section')
        return self


def _import_id(kind: str, dataset_id: str, crew: str, source_id: str) -> str:
    key = encoded([kind, dataset_id, crew, source_id]).encode('utf-8')
    return f'import:{kind}:' + hashlib.sha256(key).hexdigest()


def _scan_document(scan: BodyImportScan, dataset_id: str, received: datetime) -> Data:
    document = scan.model_dump(mode='json')
    document['id'] = _import_id('body', dataset_id, scan.crewId, scan.id)
    document['observedAt'] = utc_text(scan.observedAt)
    document['receivedAt'] = utc_text(received)
    for finding, original in zip(document['findings'], scan.findings, strict=True):
        finding['id'] = _import_id('finding', dataset_id, scan.crewId, original.id)
        finding['onsetAt'] = utc_text(original.onsetAt)
    BodyScan.model_validate(document)
    return document


def apply_body_import(db: sqlite3.Connection, section: BodyImport, dataset_id: str) -> Data:
    """Append scans without committing; caller owns authorization and atomic rollback."""
    inserted = replayed = 0
    scan_ids = []
    received = datetime.now(UTC)
    for scan in section.scans:
        document = _scan_document(scan, dataset_id, received)
        request_id = _import_id('body-request', dataset_id, scan.crewId, scan.id)
        prior = db.execute('SELECT preset,document FROM body_scans WHERE crew_id=? AND request_id=?',
                           (scan.crewId, request_id)).fetchone()
        if prior:
            previous = json.loads(prior['document'])
            document['receivedAt'] = previous['receivedAt']
            if prior['preset'] != 'import' or encoded(previous) != encoded(document):
                raise Problem(409, 'IDEMPOTENCY_CONFLICT',
                              'This dataset contains different body data for an existing scan ID.')
            replayed += 1
        else:
            db.execute('INSERT INTO body_scans VALUES(?,?,?,?,?,?)',
                       (document['id'], scan.crewId, document['observedAt'], request_id,
                        'import', encoded(document)))
            inserted += 1
        scan_ids.append(document['id'])
    return {'inserted': inserted, 'replayed': replayed, 'scanIds': scan_ids}
