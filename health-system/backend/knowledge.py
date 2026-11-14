"""Local, read-only training library and bounded, source-linked FTS5 retrieval."""
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Query, Request

from .knowledge_content import DOCUMENTS
from .store import Data, Problem, connection, encoded


def initialize_knowledge(path: Path) -> None:
    """Run after the station database is created. Keep older versions queryable."""
    with connection(path, write=True) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS knowledge_documents (
            id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, version))""")
        db.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            doc UNINDEXED, version UNINDEXED, chunk UNINDEXED, tags, heading, body)""")
        for doc in DOCUMENTS:
            inserted = db.execute("INSERT OR IGNORE INTO knowledge_documents VALUES(?,?,?)",
                                  (doc["id"], doc["version"], encoded(doc)))
            if not inserted.rowcount:
                continue
            for c in doc["chunks"]:
                db.execute("INSERT INTO knowledge_fts(doc,version,chunk,tags,heading,body) VALUES(?,?,?,?,?,?)",
                           (doc["id"], doc["version"], c["id"], " ".join(c["tags"]),
                            " ".join(c["section"].values()), " ".join(c["text"].values())))


_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "if",
    "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "we", "what", "when",
    "where", "which", "why", "with", "you", "your", "near", "not", "tell", "about", "have", "help",
}
# unicode61 keeps Chinese sentences intact. The bilingual catalog provides explicit Chinese index terms.
_CJK_TERMS = {tag for doc in DOCUMENTS for c in doc["chunks"] for tag in c["tags"] if re.search("[\u3400-\u9fff]", tag)}


def _match_expression(q: str) -> str:
    text = unicodedata.normalize("NFKC", q[:512]).casefold()
    words = [word for word in re.findall(r"[a-z0-9_]+", text) if word not in _STOPWORDS]
    words.extend(sorted(tag for tag in _CJK_TERMS if tag in text))
    return " OR ".join(f'"{word}"' for word in dict.fromkeys(words))


def search_knowledge(db: sqlite3.Connection, q: str, *, topic: str | None = None,
                     mode: str = "training", environment: str | None = None,
                     kind: str | None = None) -> list[Data]:
    """Return at most five current, education-only excerpts from the packaged training scope."""
    match = _match_expression(q)
    if not match or mode != "training":
        return []
    rows = db.execute("""
        SELECT d.body, f.chunk FROM knowledge_fts f
        JOIN knowledge_documents d ON d.id=f.doc AND d.version=f.version
        WHERE knowledge_fts MATCH ? AND d.version=(SELECT max(version) FROM knowledge_documents WHERE id=d.id)
          AND json_extract(d.body, '$.mode')='training' AND json_extract(d.body, '$.reviewStatus')='education_only'
          AND (? IS NULL OR json_extract(d.body, '$.topic')=?)
          AND (? IS NULL OR json_extract(d.body, '$.environment')=?)
          AND (? IS NULL OR json_extract(d.body, '$.kind')=?)
        ORDER BY bm25(knowledge_fts,0,0,0,5,2,1),d.id,f.rowid LIMIT 5
    """, (match, topic, topic, environment, environment, kind, kind))
    results = []
    for row in rows:
        doc = json.loads(row["body"])
        c = next(chunk for chunk in doc["chunks"] if chunk["id"] == row["chunk"])
        results.append({key: doc[key] for key in
                        ("version", "title", "kind", "mode", "topic", "environment", "audience", "reviewStatus")}
                       | {"documentId": doc["id"], "chunkId": c["id"], "chunkVersion": c["version"],
                          "section": c["section"], "text": c["text"], "sources": c["sources"],
                          "url": f"/v1/knowledge/documents/{doc['id']}?version={doc['version']}"})
    return results


def _document(db: sqlite3.Connection, doc_id: str, version: int | None, kind: str | None = None) -> Data:
    row = db.execute("""
        SELECT body FROM knowledge_documents WHERE id=? AND (? IS NULL OR version=?)
        AND (? IS NULL OR json_extract(body, '$.kind')=?) ORDER BY version DESC LIMIT 1
    """, (doc_id, version, version, kind, kind)).fetchone()
    if not row:
        raise Problem(404, "NOT_FOUND", "No local training document matches this ID and version.")
    return json.loads(row["body"])


def register_knowledge(app: FastAPI, path: Path) -> None:
    from .main import current, response

    def authorize(request: Request) -> None:
        if not {"crew", "monitor"}.intersection(current(request)["roles"]):
            raise Problem(403, "FORBIDDEN", "Training documents require a crew or monitoring account.")

    def index(request: Request, kind: str | None = None):
        authorize(request)
        with connection(path) as db:
            rows = db.execute("""SELECT body FROM knowledge_documents d WHERE
                version=(SELECT max(version) FROM knowledge_documents WHERE id=d.id)
                AND (? IS NULL OR json_extract(body,'$.kind')=?) ORDER BY d.rowid""", (kind, kind))
            items = [json.loads(row["body"]) for row in rows]
        return response({"items": [{k: v for k, v in doc.items() if k != "chunks"} for doc in items]})

    @app.get("/v1/procedures")
    def procedures(request: Request):
        return index(request, "procedure")

    @app.get("/v1/knowledge/documents")
    def documents(request: Request):
        return index(request)

    @app.get("/v1/procedures/{doc_id}")
    def procedure(request: Request, doc_id: str, version: Annotated[int | None, Query(ge=1)] = None):
        authorize(request)
        with connection(path) as db:
            return response(_document(db, doc_id, version, "procedure"))

    @app.get("/v1/knowledge/documents/{doc_id}")
    def document(request: Request, doc_id: str, version: Annotated[int | None, Query(ge=1)] = None):
        authorize(request)
        with connection(path) as db:
            return response(_document(db, doc_id, version))

    @app.get("/v1/knowledge/search")
    def search(request: Request, q: Annotated[str, Query(min_length=1, max_length=512)], topic: str | None = None,
               mode: str = "training", environment: str | None = None, kind: str | None = None):
        authorize(request)
        with connection(path) as db:
            return response({"items": search_knowledge(db, q, topic=topic, mode=mode, environment=environment,
                                                       kind=kind)})
