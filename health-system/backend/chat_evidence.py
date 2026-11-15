"""Build small, user-scoped evidence packets for the health conversation."""
import json
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from itertools import pairwise

from . import alerts, news2
from .knowledge import search_knowledge
from .models import canonical_measurement
from .store import Data, encoded
from .tasks import personal_tasks

LABELS = {
    "heart_rate": ("heart rate", "心率"), "spo2": ("blood oxygen", "血氧"),
    "respiratory_rate": ("respiratory rate", "呼吸頻率"),
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
    if re.search(r"綜合(?:健康)?(?:報告|評估)|三層|health report|saved report|comprehensive|three.layer", q):
        return "report"
    if (re.search(r"news\s*2|(?:健康|這次|這筆|本次|目前的?)評估|(?:this|health|current) assessment", q)
            or previous == "news2" and re.search(r"缺|補齊|齊全|完整|還要|更新|現在|missing|complete|still|now", q)):
        return "news2"
    if re.search(r"警示|警報|alert|warning|notifi", q):
        return "alert"
    if re.search(r"基準|基線|baseline|ewma|(?:^|\W)z(?:$|\W)|標準分數|分析|analysis", q):
        return "analysis"
    if re.search(r"血壓|pressure|收縮|舒張", q):
        return "pressure"
    if re.search(r"血氧|spo2|oxygen", q):
        return "spo2"
    if re.search(r"體溫|体温|temperature", q):
        return "temperature"
    if re.search(r"呼吸頻率|呼吸率|respiratory|respiration", q):
        return "respiratory_rate"
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
    unit = display_unit(m['unit'], m['metricCode'])
    reading = f"{m['value']} {unit}" if m["value"] is not None else ("缺值" if zh else "missing")
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
    ordered = sorted((day, sample) for day, sample in samples.items()
                     if isinstance(sample["value"], (int, float)) and not isinstance(sample["value"], bool))
    if not ordered:
        return fact("沒有可比較的數值資料。" if zh else "No comparable numeric readings are available.", required=True)
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
        m = canonical_measurement(json.loads(row[0]))
        result.append(measurement_fact(m, zh))
        if topic != "compare":
            continue
        today = datetime.now(UTC).date()
        yesterday = today - timedelta(days=1)
        samples = {}
        if (m["observedAt"][:10] == today.isoformat() and m["quality"] == "good" and isinstance(m["value"], (int, float))
                and m["context"].get("activity") in ("rest", "exercise", "recovery")):
            samples[today.isoformat()] = m
            rows = db.execute("SELECT document FROM measurements WHERE crew_id=? AND metric=? "
                              "AND observed>=? AND observed<? AND quality='good' ORDER BY observed DESC,row_id DESC",
                              (crew, metric, (today - timedelta(days=6)).isoformat(), today.isoformat()))
            for (raw,) in rows:
                other = canonical_measurement(json.loads(raw))
                day = other["observedAt"][:10]
                if day not in samples and isinstance(other["value"], (int, float)) and _matched_context(other) == _matched_context(m):
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
    scores = item.get("componentScores", {})
    if scores:
        unavailable = "無法計分" if zh else "unavailable"
        values = ("、" if zh else ", ").join(f"{labels[field]}={score if score is not None else unavailable}"
                                         for field, score in scores.items())
        parts.append(f"已儲存分項：{values}。" if zh else f"Saved component scores: {values}.")
    if item["news2Score"] is not None:
        parts.append(f"已儲存 NEWS2 總分：{item['news2Score']}。" if zh else
                     f"Saved NEWS2 total: {item['news2Score']}.")
    else:
        parts.append("此紀錄沒有可用的 NEWS2 總分。" if zh else "This record has no available NEWS2 total.")
    rule = item.get("ruleSetVersion")
    normalization = item.get("normalizationVersion")
    if rule:
        parts.append(f"保存規則版本：{rule}。" if zh else f"Saved rule version: {rule}.")
    if normalization:
        parts.append(f"訓練輸入正規化版本：{normalization}。" if zh else
                     f"Training input normalization version: {normalization}.")
    interpretation = interpretation_text(item, zh)
    if interpretation:
        parts.append(interpretation)
    if item.get("configurationIssues"):
        descriptions = {
            "scoring_profile_disabled": ("Scoring is disabled", "計分已停用"),
            "unknown_scoring_profile": ("Unsupported scoring version", "不支援的計分版本"),
            "scoring_profile_not_enabled": ("Scoring is not enabled", "計分尚未啟用"),
        }
        fallback = ("Scoring configuration is unavailable", "計分設定無法使用")
        issues = ("、" if zh else ", ").join(descriptions.get(issue, fallback)[int(zh)]
                                         for issue in item["configurationIssues"])
        parts.append(f"保存設定問題：{issues}。" if zh else f"Saved configuration issues: {issues}.")
        requested = item.get("requestedProfile")
        if requested is not None:
            parts.append(f"要求版本：{requested or '（空白）'}。" if zh else
                         f"Requested profile: {requested or '(empty)' }.")
    parts.append("本結果僅供合成資料訓練使用。" if zh else "This result is for synthetic-data training only.")
    return [fact(" ".join(parts), ref, required=True)]


def interpretation_text(item: Data, zh: bool) -> str:
    if not item.get('interpretationVersion'):
        return ''
    band_names = {'low': ('low', '低'), 'low_medium': ('low–medium', '低至中'),
                  'medium': ('medium', '中'), 'high': ('high', '高')}
    band = band_names.get(item.get('riskBand') or '', ('unavailable', '無法提供'))[int(zh)]
    names = {**LABELS, **news2.LABELS}
    singles = ', '.join(names.get(k, (k, k))[int(zh)] for k in item.get('singleHighParameters', [])) or ('無' if zh else 'none')
    return (f"RCP 圖表分級·訓練呈現：{band}；單項 3 分：{singles}；解讀版本 {item['interpretationVersion']}。"
            '不等同任務醫療核准，不改變現有通知規則。' if zh else
            f"RCP chart band, training display: {band}; parameters scoring 3: {singles}; "
            f"interpretation {item['interpretationVersion']}. This is not mission medical approval and does not change notifications.")


def build_facts(db: sqlite3.Connection, crew: str, question: str, lang: str, prior: Data | None,
                assessment_id: str | None = None, analysis_id: str | None = None,
                report_id: str | None = None) -> tuple[str, list[Data]]:
    zh = lang == "zh-TW"
    if report_id:
        return "report", report_facts(db, crew, report_id, zh)
    if assessment_id:
        return "news2", assessment_facts(db, crew, assessment_id, zh)
    if analysis_id:
        return "analysis", analysis_facts(db, crew, analysis_id, zh, question)
    topic = intent(question, prior["topic"] if prior else "")
    component_followup = (topic in {'analysis', 'news2', 'alert'}
                          and re.search(r'缺|這|那|剛才|上述|\b(?:missing|this|that|those)\b', question, re.IGNORECASE)
                          and not re.search(r'最新|latest', question, re.IGNORECASE))
    if topic == 'report' or (prior and prior['topic'] == 'report'
                             and (topic in {'followup', 'general'} or component_followup)):
        if prior and prior['topic'] == 'report' and not re.search(r'最新|latest', question, re.IGNORECASE):
            report_id = next((r['id'] for f in prior['facts'] for r in f['refs'] if r['kind'] == 'report'), None)
        return 'report', report_facts(db, crew, report_id, zh)
    if topic in {"analysis", "compare"} or (prior and prior["topic"] == "analysis" and topic in {
            "followup", "general", "heart_rate", "spo2", "temperature", "pressure", "respiratory_rate"}):
        prior_analysis = None
        if prior and prior["topic"] == "analysis":
            previous_id = next((r["id"] for f in prior["facts"] for r in f["refs"] if r["kind"] == "analysis"), None)
            if previous_id:
                from .baselines import read
                requested = requested_metrics(question)
                previous_item = read(db, crew, previous_id)
                previous_metric = previous_item.get('metricCode', 'heart_rate')
                if not requested or previous_metric in requested:
                    prior_analysis = previous_item
                    baseline = previous_item['baseline']
                    previous_context = {**baseline['context'], 'source': baseline['source']}
                    same_context = all(previous_context.get(k) == v for k, v in requested_context(question).items())
                    if same_context and not re.search(r"最新|latest", question, re.IGNORECASE):
                        analysis_id = previous_id
        evidence = analysis_facts(db, crew, analysis_id, zh, question, prior_analysis)
        if topic == "compare":
            evidence += measurement_facts(db, crew, topic, zh, question)
        # A comparison without saved analysis still owns its original measurement citations.
        selected_topic = "analysis" if any(r["kind"] == "analysis" for f in evidence for r in f["refs"]) else topic
        return selected_topic, evidence
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
    elif topic in {"heart_rate","compare","spo2","temperature","pressure","respiratory_rate"}:
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



def display_unit(unit: str, metric: str) -> str:
    return {'/min': 'bpm' if metric == 'heart_rate' else '/min', 'mm[Hg]': 'mmHg', 'Cel': '°C'}.get(unit, unit)


def requested_metrics(question: str) -> list[str]:
    patterns = [('blood_pressure_diastolic', r'舒張|diastolic'),
                ('blood_pressure_systolic', r'收縮|systolic'),
                ('spo2', r'血氧|spo2|oxygen'), ('respiratory_rate', r'呼吸|respirat'),
                ('temperature', r'體溫|体温|temperature'), ('heart_rate', r'心率|心跳|heart.?rate|pulse')]
    result = [metric for metric, pattern in patterns if re.search(pattern, question, re.IGNORECASE)]
    if not result and re.search(r'血壓|pressure', question, re.IGNORECASE):
        return ['blood_pressure_systolic', 'blood_pressure_diastolic']
    return result


def requested_context(question: str) -> dict[str, str]:
    result = {}
    for pattern, activity in ((r"靜息|靜止|at rest|resting", "rest"),
                              (r"運動後|recovery|post.exercise", "recovery"),
                              (r"運動中|during exercise", "exercise")):
        if re.search(pattern, question, re.IGNORECASE):
            result['activity'] = activity
            break
    for pattern, source in ((r"手動|manual", "manual"), (r"模擬|mock", "mock")):
        if re.search(pattern, question, re.IGNORECASE):
            result['source'] = source
            break
    return result


def _current_analysis_value(projection: str, revisions: bool) -> str:
    legacy = f'(SELECT {projection} FROM fixed_analyses WHERE measurement=m.id AND crew=m.crew_id)'
    if not revisions:
        return legacy
    return (f'COALESCE((SELECT {projection} FROM analysis_revisions WHERE measurement=m.id '
            f'AND crew=m.crew_id ORDER BY revision DESC LIMIT 1),{legacy})')


def analysis_facts(db: sqlite3.Connection, crew: str, ident: str | None, zh: bool, question: str,
                   previous: Data | None = None) -> list[Data]:
    from .baselines import REPRESENTATIVE_STATUSES, read
    if ident is None:
        # Drive from owner/metric/time history; joining the union view scans all saved analyses.
        revisions = bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analysis_revisions'").fetchone())
        selected_id = _current_analysis_value('id', revisions)
        selected_status = _current_analysis_value("json_extract(document,'$.status')", revisions)
        sql = f'SELECT {selected_id} AS id FROM measurements m WHERE m.crew_id=?'
        params = [crew]
        metrics = requested_metrics(question) or [previous.get('metricCode', 'heart_rate') if previous else 'heart_rate']
        sql += ' AND m.metric IN (' + ','.join('?' for _ in metrics) + ')'
        params.extend(metrics)
        context = ({'activity': previous['baseline']['context'].get('activity'),
                    'source': previous['baseline']['source']} if previous else {}) | requested_context(question)
        for key, path in (('activity', '$.context.activity'), ('source', '$.provenance.source')):
            if context.get(key):
                sql += ' AND json_extract(m.document,?)=?'
                params.extend([path, context[key]])
        sql += f' AND {selected_status} IN (?,?)'
        params.extend(REPRESENTATIVE_STATUSES)
        row = db.execute(sql + " ORDER BY m.observed DESC,m.row_id DESC LIMIT 1", params).fetchone()
        if not row:
            return [fact("尚未建立符合條件的固定基準分析，無法提供 Z 或 EWMA。" if zh else
                         "No saved fixed-baseline analysis matches this context. Z and EWMA are unavailable.", required=True)]
        ident = row[0]
    item = read(db, crew, ident)
    return [saved_analysis_fact(item, zh)]


def saved_analysis_fact(item: Data, zh: bool) -> Data:
    base = item['baseline']
    title = '固定基準分析' if zh else 'Fixed-baseline analysis'
    ref = {'kind':'analysis', 'id':item['id'], 'version':item['baselineVersion'],
           'title':f"{title} · {item['observedAt'][:19]} UTC · v{item['baselineVersion']}"}
    statuses = {
        'ready': ('ready', '可用'),
        'unusable_quality': ('missing or poor-quality input; segment reset', '缺值或品質不足，已重新分段'),
        'out_of_order': ('late input; saved state preserved', '延遲補入，保留既有分析狀態'),
        'duplicate_bucket': ('another valid sample already represents this UTC second', '同一 UTC 秒已有有效代表樣本'),
    }
    status = statuses[item['status']][int(zh)]
    unavailable = '無法計算' if zh else 'unavailable'
    z = format(item['z'], '.6g') if item['z'] is not None else unavailable
    ewma = format(item['ewma'], '.6g') if item['ewma'] is not None else unavailable
    mean, sd = format(base['mean'], '.6g'), format(base['sd'], '.6g')
    activity = label(base['context'].get('activity', 'unknown'), zh)
    methods = {'mock_generated': ('mock-generated', '模擬產生'),
               'manual_training_entry': ('manual training entry', '手動訓練輸入')}
    method = methods.get(base['method'], (base['method'], base['method']))[int(zh)]
    stamp = item['observedAt'][:19].replace('T', ' ') + ' UTC'
    value = item['value'] if item['value'] is not None else ('缺值' if zh else 'missing')
    metric = item.get('metricCode', 'heart_rate')
    metric_name, unit = label(metric, zh), display_unit(item['unit'], metric)
    text = (f"{stamp} 已儲存{metric_name}分析：{value} {unit}；狀態：{status}；Z={z}，EWMA={ewma}。"
            f"固定基準 v{base['version']}：n={base['count']}，平均={mean}，樣本標準差={sd}；"
            f"期間 [{base['from']}, {base['to']})；來源 {base['source']}，方法：{method}，活動：{activity}。"
            "統計數值顯示為六位有效數字近似值。這是個人統計偏離，無法單獨判定健康風險。"
            if zh else f"{stamp} saved {metric_name} analysis: {value} {unit}; status: {status}; "
            f"Z={z}, EWMA={ewma}. Fixed baseline v{base['version']}: n={base['count']}, "
            f"mean={mean}, sample SD={sd}; [{base['from']}, {base['to']}); "
            f"source {base['source']}, method: {method}, activity: {activity}. "
            "Statistics are shown to six significant figures. Statistical deviation alone does not establish health risk.")
    return fact(text, [ref], required=True)


def report_facts(db: sqlite3.Connection, crew: str, ident: str | None, zh: bool) -> list[Data]:
    from . import health_reports
    if ident is None:
        latest = health_reports.summaries(db, crew)
        if not latest:
            return [fact('尚未保存綜合報告，沒有可引用的三層快照。' if zh else
                         'No comprehensive report has been saved; no three-layer snapshot is available.', required=True)]
        ident = latest[0]['id']
    item = health_reports.read(db, crew, ident)
    lang = 'zh-TW' if zh else 'en'
    ref = {'kind': 'report', 'id': ident, 'version': item['version'],
           'title': ('綜合報告' if zh else 'Health report') + f" · {item['createdAt']}"}
    assessment = item['news2']
    unavailable = '未知／無法計分' if zh else 'unknown / unavailable'
    score = assessment['news2Score'] if assessment and assessment['news2Score'] is not None else unavailable
    layer1 = (f"第一層：保存 NEWS2 總分 {score}。" if zh else f'Layer 1: saved NEWS2 total {score}. ')
    if assessment:
        layer1 += (f"評估 {assessment['id']} v{assessment['version']}；規則 {assessment.get('ruleSetVersion')}；"
                   f"分項 {encoded(assessment.get('componentScores', {}))}；缺項 {encoded(assessment['missingInputs'])}；"
                   f"無效輸入 {encoded(assessment['invalidReasons'])}；觀察細節缺項 {encoded(assessment['missingDetails'])}。" if zh else
                   f"Assessment {assessment['id']} v{assessment['version']}; rule {assessment.get('ruleSetVersion')}; "
                   f"components {encoded(assessment.get('componentScores', {}))}; missing {encoded(assessment['missingInputs'])}; "
                   f"invalid {encoded(assessment['invalidReasons'])}; missing details {encoded(assessment['missingDetails'])}.")
        layer1 += interpretation_text(assessment, zh)
    result = [fact(layer1, [ref], required=True)]
    for stat in item['statistics']:
        if stat['analysis']:
            evidence = saved_analysis_fact(stat['analysis'], zh)
            evidence['text'] = ('第二層：' if zh else 'Layer 2: ') + evidence['text']
            # Resolve the complete frozen report, not a separately changing source.
            evidence['refs'] = [ref]
            result.append(evidence)
        else:
            result.append(fact((f"第二層：{label(stat['metricCode'], zh)}沒有精確對應的保存分析；{stat['reason']}。" if zh else
                                f"Layer 2: {label(stat['metricCode'], zh)} has no exact saved analysis; {stat['reason']}."),
                               [ref], required=True))
    if item['alerts']:
        for alert in item['alerts']:
            result.append(fact((f"既有警示 {alert['id']} v{alert['version']}：狀態 {alert['conditionState']}；"
                               f"規則 {alert['ruleId']} v{alert['ruleVersion']}；程序 {alert['procedureId']} v{alert['procedureVersion']}。" if zh else
                               f"Existing alert {alert['id']} v{alert['version']}: {alert['conditionState']}; "
                               f"rule {alert['ruleId']} v{alert['ruleVersion']}; procedure {alert['procedureId']} v{alert['procedureVersion']}."),
                              [ref], required=True))
    else:
        result.append(fact('保存當下沒有本人既有警示；這不代表健康正常。' if zh else
                           'No existing alerts were recorded at save time; this does not establish normal health.', [ref], required=True))
    versions = ', '.join(f"{k['documentId']} v{k['version']}" for k in item['summary']['knowledgeVersions'])
    result.append(fact(f'第三層：固定的本機教育知識版本 {versions}；僅供來源解釋。' if zh else
                       f'Layer 3: pinned local educational knowledge {versions}; source explanation only.', [ref], required=True))
    for chunk in item['knowledge']:
        result.append(fact(chunk['text'][lang], [ref, {'kind': 'knowledge', 'id': chunk['documentId'],
            'version': chunk['version'], 'chunkId': chunk['chunkId'], 'title': chunk['section'][lang]}], required=True))
    for limit in item['limits']:
        result.append(fact(limit['text'][lang], [ref], required=True))
    return result
