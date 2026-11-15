"""RCP NEWS2 Chart 1 scoring for synthetic training, with explicit input normalization."""
import os
from decimal import ROUND_HALF_UP, Decimal, localcontext

from .store import Data

PROFILE = "rcp-news2-2017-training-v1"
NORMALIZATION = "decimal-half-up-v1"
INTERPRETATION = 'rcp-news2-thresholds-2017-v1'
SCORING_SOURCE = 'https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf'
INTERPRETATION_SOURCE = 'https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf'
COMPONENTS = ("respiratory_rate", "spo2", "blood_pressure_systolic", "heart_rate",
              "neurological_assessment", "temperature", "supplemental_oxygen")
# RCP NEWS2 (2017), Chart 1. The final band has no upper bound.
BANDS = {
    "respiratory_rate": ((8, 3), (11, 1), (20, 0), (24, 2), (float("inf"), 3)),
    "blood_pressure_systolic": ((90, 3), (100, 2), (110, 1), (219, 0), (float("inf"), 3)),
    "heart_rate": ((40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (float("inf"), 3)),
    "temperature": ((35.0, 3), (36.0, 1), (38.0, 0), (39.0, 1), (float("inf"), 2)),
    "scale1": ((91, 3), (93, 2), (95, 1), (float("inf"), 0)),
    "scale2": ((83, 3), (85, 2), (87, 1), (92, 0), (94, 1), (96, 2), (float("inf"), 3)),
}


def configuration() -> Data:
    requested = os.environ.get("HEALTH_NEWS2_PROFILE", PROFILE)
    enabled = requested == PROFILE
    issues = [] if enabled else ["scoring_profile_disabled" if requested == "disabled" else "unknown_scoring_profile"]
    return {"enabled": enabled, "requestedProfile": requested, "ruleSetVersion": PROFILE if enabled else None,
            "normalizationVersion": NORMALIZATION if enabled else None, "configurationIssues": issues}


def normalize(value: float, field: str) -> int | float:
    decimal = Decimal(str(value))
    if field != "temperature":
        return int(decimal.to_integral_value(rounding=ROUND_HALF_UP))
    with localcontext() as context:
        context.prec = max(28, decimal.adjusted() + 3)
        return float(decimal.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def band_score(value: float, kind: str) -> int:
    return next(score for upper, score in BANDS[kind] if value <= upper)


def score_inputs(effective: Data, invalid: dict[str, str], complete: bool) -> Data:
    config = configuration()
    normalized: Data = dict.fromkeys((*COMPONENTS, "spo2_scale"))
    scores: dict[str, int | None] = dict.fromkeys(COMPONENTS)
    result = {k: v for k, v in config.items() if k != "enabled"}
    result.update(componentScores=scores, scoringInputs=normalized, news2Score=None,
                  singleHighParameters=[], riskBand=None, interpretationVersion=None,
                  scoringSource=None, interpretationSource=None)
    if not config["enabled"]:
        return result
    for field in normalized:
        value = effective.get(field)
        if value is None or field in invalid:
            continue
        normalized[field] = normalize(value, field) if field in BANDS or field == "spo2" else value
    for field in COMPONENTS:
        value = normalized[field]
        if value is None:
            continue
        if field in BANDS:
            scores[field] = band_score(value, field)
        elif field == "neurological_assessment":
            scores[field] = 0 if value == "A" else 3
        elif field == "supplemental_oxygen":
            scores[field] = 2 if value else 0
        elif normalized["spo2_scale"] == "scale1":
            scores[field] = band_score(value, "scale1")
        elif normalized["spo2_scale"] == "scale2":
            oxygen = normalized["supplemental_oxygen"]
            if value <= 92 or oxygen is True:
                scores[field] = band_score(value, "scale2")
            elif oxygen is False:
                scores[field] = 0
    if complete and all(value is not None for value in scores.values()):
        result["news2Score"] = sum(value for value in scores.values() if value is not None)
    single = [field for field, score in scores.items() if score == 3]
    total = result['news2Score']
    band = None if total is None else ('high' if total >= 7 else 'medium' if total >= 5 else
                                      'low_medium' if single else 'low')
    result.update(singleHighParameters=single, riskBand=band, interpretationVersion=INTERPRETATION,
                  scoringSource=SCORING_SOURCE, interpretationSource=INTERPRETATION_SOURCE)
    return result
