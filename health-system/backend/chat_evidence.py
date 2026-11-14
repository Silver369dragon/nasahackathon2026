"""Build small, user-scoped evidence packets for the health conversation."""
import json
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from itertools import pairwise

from . import alerts, news2
from .knowledge import search_knowledge
from .store import Data
from .tasks import personal_tasks

LABELS = {
    "heart_rate": ("heart rate", "心率"), "spo2": ("blood oxygen", "血氧"),
    "temperature": ("temperature", "體溫"), "blood_pressure_systolic": ("systolic pressure", "收縮壓"),
    "blood_pressure_diastolic": ("diastolic pressure", "舒張壓"), "rest": ("rest", "靜息"),
    "exercise": ("exercise", "運動"), "recovery": ("post-exercise recovery", "運動後恢復"),
    "cycle": ("cycling", "腳踏車"), "resistance": ("resistance training", "阻力訓練"),
    "treadmill": ("treadmill", "跑步機"), "measurement": ("vital-sign measurement", "生命徵象量測"),
    "self_check": ("post-training check-in", "訓練後自評"), "unknown": ("unrecorded", "未記錄"),
}


def label(code: str, zh: bool) -> str:
    return LABELS.get(code, (code, code))[int(zh)]


def intent(q: str, previous: str) -> str:
    q = q.casefold()
    if (re.search(r"news\s*2|(?:健康|這次|這筆|本次|目前的?)評估|(?:this|health|current) assessment", q)
            or previous == "news2" and re.search(r"缺|補齊|齊全|完整|還要|更新|現在|missing|complete|still|now", q)):
        return "news2"
    if re.search(r"警示|警報|alert|warning|notifi", q):
        return "alert"
    if re.search(r"血壓|pressure|收縮|舒張", q):
        return "pressure"
    if re.search(r"血氧|spo2|oxygen", q):
        return "spo2"
    if re.search(r"體溫|体温|temperature", q):
        return "temperature"
    if re.search(r"昨天|昨日|趨勢|比較|yesterday|trend|compar|higher|lower", q):
        return "compare"
    if re.search(r"心率|心跳|heart.?rate|pulse|靜息|靜止|at rest", q):
        return "heart_rate"
    if re.search(r"任務|我.*訓練|完成|課表|today.{0,16}train|tasks?|workout|complete|did i|my training", q):
        return "tasks"
    if re.search(r"哪一筆|哪筆|那筆|剛才|哪個|which|that one|those|that reading|follow.up", q):
        return "followup" if previous else "general"
    return "general"


def fact(text: str, refs: list[Data] | None = None, *, required: bool = False) -> Data:
    return {"text": text, "refs": refs or [], "required": required}


def measurement_fact(m: Data, zh: bool) -> Data:
    activity = m["context"].get("activity")
    reading = f"{m['value']} {m['unit']}" if m["value"] is not None else ("缺值" if zh else "missing")
    stamp = m["observedAt"].replace("T", " ")[:19] + " UTC"
    metric = label(m["metricCode"], zh)
    context = label(activity if activity in ("rest", "exercise", "recovery") else "unknown", zh)
    source = m["provenance"]["source"]
    quality = m["quality"]
    extras = f" · {context}" if m["metricCode"] == "heart_rate" else ""
    text = (f"{stamp} 的{metric}為 {reading}{extras}（{source}，品質 {quality}）。" if zh else
            f"{stamp}: {metric} was {reading}{extras} ({source}, quality: {quality}).")
    ref = {"kind": "measurement", "id": m["id"], "title": f"{metric} · {stamp}"}
    return fact(text, [ref], required=True)


def _matched_context(m: Data) -> tuple:
    p, c = m["provenance"], m["context"]
    return (m["method"], m["unit"], c.get("activity"), c.get("measurementSite"), p["source"],
            p.get("dataOrigin"), p["isSynthetic"], m["quality"])


def trend_fact(samples: dict[str, Data], zh: bool) -> Data:
    ordered = sorted(samples.items())
    values = [sample["value"] for _, sample in ordered]
    steps = [b - a for a, b in pairwise(values)]
    if all(step == 0 for step in steps):
        pattern = ("were the same", "持平")
    elif all(step >= 0 for step in steps):
        pattern = ("were stable or increased", "持平或上升")
    elif all(step <= 0 for step in steps):
        pattern = ("were stable or decreased", "持平或下降")
    else:
        pattern = ("varied in both directions", "有升有降")
    window = f"{ordered[0][0]} – {ordered[-1][0]}"
    refs = [measurement_fact(sample, zh)["refs"][0] for _, sample in ordered]
    text = (f"{window}，共有 {len(ordered)} 個可比較的 UTC 日。各日最後一筆有效心率{pattern[1]}，"
            "這些讀值無法單獨說明變化原因。" if zh else
            f"Across {len(ordered)} comparable UTC days ({window}), the last valid heart-rate readings "
            f"per day {pattern[0]}. The measurements alone do not establish the cause.")
    return fact(text, refs, required=True)


def measurement_facts(db: sqlite3.Connection, crew: str, topic: str, zh: bool, question: str = "") -> list[Data]:
    metrics = ("blood_pressure_systolic", "blood_pressure_diastolic") if topic == "pressure" else (
        "heart_rate" if topic == "compare" else topic,)
    result: list[Data] = []
    for metric in metrics:
        sql = "SELECT document FROM measurements WHERE crew_id=? AND metric=?"
        params = [crew, metric]
        if topic == "compare":
            for pattern, activity in ((r"靜息|靜止|at rest|resting", "rest"),
                                      (r"運動後|recovery|post.exercise", "recovery"),
                                      (r"運動中|during exercise", "exercise")):
                if re.search(pattern, question.casefold()):
                    sql += " AND json_extract(document,'$.context.activity')=?"
                    params.append(activity)
                    break
        row = db.execute(sql + " ORDER BY observed DESC,row_id DESC LIMIT 1", params).fetchone()
        if not row:
            result.append(fact(f"目前沒有本人的{label(metric, zh)}紀錄。" if zh else
                               f"You have no recorded {label(metric, zh)}.", required=True))
            continue
        m = json.loads(row[0])
        result.append(measurement_fact(m, zh))
        if topic != "compare":
            continue
        today = datetime.now(UTC).date()
        yesterday = today - timedelta(days=1)
        samples = {}
        if (m["observedAt"][:10] == today.isoformat() and m["quality"] == "good" and m["value"] is not None
                and m["context"].get("activity") in ("rest", "exercise", "recovery")):
            samples[today.isoformat()] = m
            rows = db.execute("SELECT document FROM measurements WHERE crew_id=? AND metric=? "
                              "AND observed>=? AND observed<? AND quality='good' ORDER BY observed DESC,row_id DESC",
                              (crew, metric, (today - timedelta(days=6)).isoformat(), today.isoformat()))
            for (raw,) in rows:
                other = json.loads(raw)
                day = other["observedAt"][:10]
                if day not in samples and other["value"] is not None and _matched_context(other) == _matched_context(m):
                    samples[day] = other
                if len(samples) == 7:
                    break
        if len(samples) >= 3:
            result.append(trend_fact(samples, zh))
        prev = samples.get(yesterday.isoformat())
        if prev is None:
            result.append(fact("今天與昨天缺少活動情境、方法、來源和品質相符的有效心率，無法判定日間差異。" if zh else
                               "A comparable valid heart-rate reading for both today and yesterday is missing.",
                               required=True))
            continue
        before = measurement_fact(prev, zh)
        result.append(before)
        delta = m["value"] - prev["value"]
        result.append(fact((f"相同條件下兩次讀值相差 {delta:+g} bpm（今天減昨天）。兩次讀值無法判定原因或長期趨勢。" if zh else
                            f"The two comparable readings differ by {delta:+g} bpm (today minus yesterday). "
                            "These two readings alone cannot establish a cause or a long-term trend."),
                           result[0]["refs"] + before["refs"], required=True))
    return result


def task_facts(db: sqlite3.Connection, crew: str, zh: bool) -> list[Data]:
    result = []
    for task in personal_tasks(db, crew)["items"]:
        if task["status"] != "completed":
            continue
        name = label(task["activity"] or task["kind"], zh)
        stamp = task["completedAt"].replace("T", " ")[:19] + " UTC"
        evidence = task["evidence"] or {}
        minutes = evidence.get("durationSeconds")
        duration = "" if minutes is None else (f"（{minutes/60:g} 分鐘）" if zh else f" ({minutes/60:g} min)")
        result.append(fact(f"{stamp} 完成了{name}{duration}。" if zh else f"Completed {name}{duration} at {stamp}.",
                           [{"kind": "task", "id": task["id"], "title": f"{name} · {stamp}"}], required=True))
    return result or [fact("今天尚未有已完成的任務紀錄。" if zh else "No tasks are recorded as completed today.",
                           required=True)]


def assessment_facts(db: sqlite3.Connection, crew: str, ident: str | None, zh: bool) -> list[Data]:
    labels = {k: names[int(zh)] for k, names in (news2.LABELS | news2.DETAILS).items()}
    if ident is None:
        latest = news2.summaries(db, crew)
        if not latest:
            fields = "、".join(labels[k] for k in news2.LABELS) if zh else ", ".join(labels[k] for k in news2.LABELS)
            return [fact(f"目前沒有本人的 NEWS2 評估紀錄，無法提供總分。請先建立一次評估並記錄{fields}。"
                         if zh else f"No NEWS2 assessment has been recorded. Start one and record {fields}. "
                         "A total cannot be calculated.", required=True)]
        ident = latest[0]["id"]
    item = news2.read(db, crew, ident)
    stamp = item["observedAt"][:19].replace("T"," ") + " UTC"
    ref = [{"kind": "assessment", "id": ident, "version": item["version"], "title": f"NEWS2 · {stamp} · v{item['version']}"}]
    parts = [f"{stamp} 這次 NEWS2 評估有 {item['validCount']}/8 項可用。" if zh else
             f"The NEWS2 assessment at {stamp} has {item['validCount']}/8 usable inputs."]
    if item["missingInputs"]:
        fields = ("、" if zh else ", ").join(labels[k] for k in item["missingInputs"])
        parts.append(f"尚缺{fields}。" if zh else f"Missing inputs: {fields}.")
    reasons = {"unusable_quality": ("unusable quality", "品質不足"), "outside_training_window":
               ("outside the five-minute training window", "超出同次評估的五分鐘訓練時間窗"),
               "missing_context": ("incomplete context", "觀察資料未齊")}
    for field, reason in item["invalidReasons"].items():
        parts.append(f"{labels[field]}（{reasons[reason][int(zh)]}）。" if zh else
                     f"Recheck {labels[field]} ({reasons[reason][0]}).")
    if item["missingDetails"]:
        fields = ("、" if zh else ", ").join(labels[k] for k in item["missingDetails"])
        parts.append(f"請補記{fields}。" if zh else f"Also record {fields}.")
    parts.append("船內評分設定尚未核准，無法提供 NEWS2 總分。" if zh else
                 "No mission scoring profile is approved. A NEWS2 total is unavailable.")
    return [fact(" ".join(parts), ref, required=True)]


def build_facts(db: sqlite3.Connection, crew: str, question: str, lang: str, prior: Data | None,
                assessment_id: str | None = None) -> tuple[str, list[Data]]:
    zh = lang == "zh-TW"
    topic = intent(question, prior["topic"] if prior else "")
    if assessment_id or topic == "news2" or (topic == "followup" and prior and prior["topic"] == "news2"):
        if not assessment_id and prior and prior["topic"] == "news2" and not re.search(r"最新|latest", question, re.IGNORECASE):
            assessment_id = next((r["id"] for f in prior["facts"] for r in f["refs"] if r["kind"] == "assessment"), None)
        return "news2", assessment_facts(db, crew, assessment_id, zh)
    if topic == "followup" and prior:
        refs = [ref for f in prior["facts"] for ref in f["refs"] if ref["kind"] in {"task","alert","measurement"}]
        if refs:
            items = [f for f in prior["facts"] if f["refs"] and f["refs"][0]["kind"] != "knowledge"]
            return prior["topic"], items
        topic = prior["topic"]
    facts: list[Data] = []
    if topic == "tasks":
        facts = task_facts(db, crew, zh)
    elif topic in {"heart_rate","compare","spo2","temperature","pressure"}:
        facts = measurement_facts(db, crew, topic, zh, question)
    elif topic == "alert":
        recent = alerts.list_alerts(db, crew)
        if recent:
            a = recent[0]
            stamp = a["createdAt"].replace("T"," ")[:19] + " UTC"
            facts.append(fact((f"{stamp} 的訓練警示由連續三秒有效合成靜息心率高於 110 bpm 觸發。"
                               f"目前條件狀態：{a['conditionState']}。" if zh else
                               f"The training alert at {stamp} was triggered by three consecutive seconds of valid "
                               f"synthetic resting heart rate above 110 bpm. Current condition: {a['conditionState']}."),
                              [{"kind":"alert","id":a["id"],"title":f"{a['ruleId']} · {stamp}"}], required=True))
            for mid in a["initialEvidenceMeasurementIds"][:3]:
                row = db.execute("SELECT document FROM measurements WHERE crew_id=? AND id=?", (crew, mid)).fetchone()
                if row:
                    facts.append(measurement_fact(json.loads(row[0]), zh))
        else:
            facts.append(fact("本人的健康紀錄目前沒有感測警示。" if zh else
                              "Your record currently contains no sensor alerts.", required=True))
    query = "training-recheck" if topic == "alert" else question
    for chunk in search_knowledge(db, query, kind="education"):
        ref = {"kind":"knowledge", "id":chunk["documentId"], "chunkId":chunk["chunkId"],
               "version":chunk["version"], "title":chunk["section"][lang]}
        facts.append(fact(chunk["text"][lang], [ref]))
    if not facts:
        facts.append(fact("目前沒有符合這個問題的本人紀錄或知識來源。可以詢問今天的任務、心率或感測警示。"
                          if zh else "No applicable record or source was found. Ask about today's tasks, a vital sign "
                          "or a sensor alert.", required=True))
    return topic, facts

