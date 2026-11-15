"""Versioned training material. Each excerpt names the sources supporting that section."""
from .store import Data


def bilingual(en: str, zh: str) -> dict[str, str]:
    return {"en": en, "zh-TW": zh}


def source(identifier: str, title: str, version: str, url: str, section: str) -> Data:
    return {"id": identifier, "title": title, "version": version, "url": url,
            "section": section, "checkedOn": "2026-11-14"}


CPR = source("dglrm-esam-cpr", "Hinkelbein et al. · CPR during spaceflight", "2020-11-02",
             "https://pmc.ncbi.nlm.nih.gov/articles/PMC7607644/", "Recommendations 1, 2 and 10")
RESPONSE = source("arc-responsiveness", "American Red Cross · Unresponsive & Breathing Person",
                  "accessed 2026-11-14", "https://www.redcross.org/take-a-class/resources/learn-first-aid/"
                  "unresponsive-and-breathing-person", "Recognition and general care")
BLEEDING = source("arc-bleeding", "American Red Cross · Life-Threatening External Bleeding",
                  "accessed 2026-11-14", "https://www.redcross.org/take-a-class/resources/learn-first-aid/"
                  "bleeding-life-threatening-external", "Emergency steps, direct pressure and FAQs")
EXERCISE = source("nasa-fitness", "NASA · Risk of Reduced Cardiorespiratory and Musculoskeletal Fitness",
                  "2025-05-16", "https://www.nasa.gov/reference/"
                  "risk-of-reduced-cardiorespiratory-and-musculoskeletal-fitness/", "Risks and countermeasures")
OXIMETER = source("fda-oximeter", "FDA · Pulse Oximeter Basics", "accessed 2026-11-14",
                  "https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics", "Using a pulse oximeter")
RULE = source("training-hr-rule", "Orbital · TRAINING_HR_RECHECK", "training-rules-1 / rule 1",
              "/v1/knowledge/documents/training-recheck?version=1", "backend/alerts.py · DEFINITION")
NEWS2 = source('rcp-news2', 'Royal College of Physicians · NEWS2', '2017',
               'https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/', 'How NEWS works; NEWS2 Report')
EWMA = source('nist-ewma', 'NIST/SEMATECH · EWMA Control Charts', 'accessed 2026-11-15',
              'https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm', 'Definition and baseline assumptions')
ENGINE = source('orbital-statistics', 'Orbital saved statistical evidence', 'fixed-baseline-v2',
                '/v1/knowledge/documents/assessment-statistics?version=1',
                'Implementation: backend/baselines.py; backend/health_reports.py; synthetic training only')
for evidence_source in (NEWS2, EWMA, ENGINE):
    evidence_source['checkedOn'] = '2026-11-15'


def chunk(identifier: str, section: tuple[str, str], body: tuple[str, str], tags: str, *sources: Data) -> Data:
    return {"id": identifier, "version": 1, "section": bilingual(*section), "text": bilingual(*body),
            "tags": tags.split(), "sources": list(sources)}


def document(identifier: str, title: tuple[str, str], kind: str, topic: str, environment: str,
             audience: tuple[str, str], purpose: tuple[str, str], chunks: list[Data]) -> Data:
    sources = {s["id"]: s for c in chunks for s in c["sources"]}
    return {"id": identifier, "version": 1, "kind": kind, "topic": topic, "title": bilingual(*title),
            "environment": environment, "audience": bilingual(*audience), "purpose": bilingual(*purpose),
            "mode": "training", "reviewStatus": "education_only", "missionApproved": False,
            "sources": list(sources.values()), "chunks": chunks}


CREW = ("Crew in training", "受訓船員")
DOCUMENTS = [
    document('assessment-statistics', ('Reading a saved three-layer report', '閱讀已保存的三層報告'),
             'education', 'assessment', 'training', CREW,
             ('Understand the limits of saved training evidence.', '了解已保存訓練證據的限制。'), [
        chunk('news2-scope', ('NEWS2 and completeness', 'NEWS2 與完整性'),
              (('NEWS2 uses six physiological parameters and supplemental oxygen status. '
               'In this training system, eight usable inputs mean completeness, not a score of eight. '
               'The report displays the saved score and rule version; missing or unusable inputs are not zero. '
               'This synthetic implementation has not been validated for mission medical decisions.'),
               ('NEWS2 使用六項生理參數及補氧狀態。本訓練系統的八項可用輸入代表完整度，不代表八分。'
               '報告呈現已保存分數及規則版本，缺漏或無法使用的輸入不視為零。此合成資料實作未經任務醫療決策驗證。')),
              'NEWS2 assessment 評估 完整度 分數', NEWS2, ENGINE),
        chunk('baseline-scope', ('Baseline and statistical deviation', '基準與統計偏離'),
              (('The saved Z value expresses distance from a selected personal reference mean in sample standard deviations. '
               'EWMA gives progressively less weight to older samples. Representative historical data and comparable '
               'measurement conditions matter. These statistics are not validated clinical risk thresholds.'),
               ('保存的 Z 值以樣本標準差表示量測與選定個人參考平均值的距離。EWMA 對較舊樣本逐步降低權重。'
               '歷史資料是否具代表性、量測條件是否可比較都會影響解讀。這些統計並非經驗證的臨床風險門檻。')),
              'baseline statistics EWMA Z 基準 統計 偏離', EWMA, ENGINE),
        chunk('snapshot-limits', ('Exact evidence and snapshot limits', '精確證據與快照限制'),
              (('A report pins the NEWS2 version, exact linked measurement IDs, saved analyses and baseline versions, '
               'alert states, and local knowledge versions. Different times, sources, methods, activities and quality '
               'must remain visible. A hand-entered NEWS2 value cannot borrow an unrelated measurement analysis. '
               'Saving or reading a report does not recalculate scores or send a notification.'),
               ('報告固定 NEWS2 版本、精確連結的量測 ID、已保存分析與基準版本、警示狀態及本機知識版本。'
               '不同時間、來源、方法、活動與品質必須明示。手填 NEWS2 數值不能借用無關量測的分析。'
               '保存或讀取報告不會重新計分或發出通知。')),
              'NEWS2 baseline statistics snapshot 報告 基準 統計 限制', ENGINE),
    ]),
    document("unresponsive", ("Unresponsive adult / suspected cardiac arrest", "成人無反應／疑似心搏停止"),
             "procedure", "first-aid", "microgravity", CREW,
             ("Practice recognizing an emergency. Use your mission’s medical procedures in flight.",
              "練習辨識緊急狀況。實際飛行時遵循任務醫療程序。"), [
        chunk("recognize", ("Call for help and check breathing", "立即呼救，確認呼吸"),
              (("Call out to nearby crew for medical help and equipment. Call the person's name, tap their "
               "shoulder and call again. Check for normal breathing at the same time, within 10 seconds."),
               "大聲請附近船員支援並取急救裝備。呼喊當事人、輕拍肩膀、再呼喊，同時觀察是否正常呼吸，檢查不超過 10 秒。"),
              "急救 無反應 失去意識 沒反應 呼吸 求助 unresponsive unconscious breathing help", RESPONSE, CPR),
        chunk("breathing", ("If breathing normally", "若有正常呼吸"),
              (("Stay with the unresponsive person, watch their breathing and report changes to the medical "
               "responder. Do not start chest compressions while the person is breathing normally."),
               "若無反應但仍正常呼吸，留在旁邊持續觀察呼吸，向醫療支援人員回報變化。正常呼吸時不做胸外按壓。"),
              "昏迷 正常呼吸 無反應 unresponsive breathing", RESPONSE),
        chunk("resuscitation", ("If breathing is absent or there are only gasps", "若沒有呼吸或只剩瀕死喘息"),
              (("If an unresponsive adult has stopped breathing or is only gasping, start CPR immediately. Begin the chest "
               "compressions you trained for in microgravity. The guideline recommends the Evetts–Russomano "
               "technique first. Have a crewmate bring the AED. Use it only with the patient secured on an "
               "electrically isolated, safe surface as trained."),
               ("成人無反應且無正常呼吸（包括僅有瀕死喘息），應立即施行心肺復甦。依微重力訓練開始胸外按壓，文獻建議初期採 "
               "Evetts–Russomano 法。請隊友取 AED，待患者固定於安全且電氣隔離的表面，再依訓練使用。")),
              "心搏停止 心跳停止 心肺復甦 胸外按壓 急救 cpr cardiac arrest aed gasping", CPR, RESPONSE),
    ]),
    document("severe-bleeding", ("Life-threatening external bleeding", "危及生命的外出血"),
             "procedure", "first-aid", "ground", ("Responders at a ground exercise", "地面演練的施救者"),
             ("Practice controlling visible bleeding on the ground.", "練習在地面處理可見的嚴重出血。"), [
        chunk("call", ("Call emergency services", "請人聯絡當地緊急救護"),
              (("Continuous heavy flow or spurting blood needs urgent help. Check that you can approach "
               "safely, ask someone to call local emergency services and bring dressings. Use gloves if available."),
               "血液持續大量流出或噴出時，立即求援。確認現場安全，請旁人聯絡當地緊急救護並取敷料，有手套時請戴上。"),
              "大出血 嚴重出血 噴血 血流不止 急救 bleeding blood spurting", BLEEDING),
        chunk("pressure", ("Press on the bleeding site", "在出血處持續加壓"),
              (("Cover the wound with gauze or clean cloth and press firmly and continuously. If an object "
               "is embedded, leave it there and press around it. For life-threatening limb bleeding, a "
               "trained responder may apply a tourniquet."),
               "用紗布或乾淨布料蓋住傷口，持續用力直接加壓。傷口若有嵌入物，保留原位並壓住周圍。肢體出血危及生命時，受過訓練者可施用止血帶。"),
              "止血 加壓 敷料 止血帶 傷口 tourniquet pressure bleeding", BLEEDING),
        chunk("handover", ("Maintain pressure and watch breathing", "持續止血並觀察呼吸"),
              (("Keep pressing until bleeding stops or another responder takes over. When using a limb "
               "tourniquet, maintain pressure until it controls the bleeding. Stay with the person and "
               "tell arriving responders about changes in breathing or responsiveness."),
               "持續加壓直到止血或有人接手。若使用肢體止血帶，維持加壓直到止血帶控制出血。陪伴患者，向抵達的救護人員回報呼吸與意識變化。"),
              "止血 交接 出血 bleeding handover", BLEEDING),
    ]),
    document("exercise", ("Exercise in microgravity", "微重力下的運動"), "education", "exercise", "microgravity",
             CREW, ("Understand the role of exercise in flight.", "了解太空任務安排運動的原因。"), [
        chunk("fitness", ("Why crews exercise", "船員為什麼要運動"),
              (("Muscles, bones and aerobic fitness can decline in microgravity. Space station crews use "
               "both resistance exercise and aerobic workouts to maintain strength and endurance. Training "
               "plans depend on individual fitness and the equipment available."),
               "微重力可能使肌力、骨骼強度及心肺耐力下降。太空站船員結合阻力訓練與有氧運動，維持肌力和耐力。訓練安排須考慮個人狀況與可用器材。"),
              "運動 鍛鍊 肌力 肌肉 骨骼 心肺 耐力 有氧 阻力 運動量 fitness exercise workout muscle bone aerobic resistance training", EXERCISE),
    ]),
    document("measurement-quality", ("Pulse oximeter measurement quality", "血氧量測品質"),
             "education", "measurement-quality", "ground", CREW,
             ("Practice taking a fingertip reading on the ground.", "練習在地面取得指尖血氧讀值。"), [
        chunk("signal", ("Getting a stable reading", "取得穩定讀值"),
              (("Follow the device instructions. Warm and relax the hand, remove nail polish on the "
               "measured finger and keep it still. Wait for a stable number before recording it and the time."),
               "依裝置說明量測，讓手保持溫暖、放鬆，去除受測指甲的指甲油。手指保持不動，等數字穩定後再記錄讀值與時間。"),
              "量測 量測品質 血氧 血氧機 血氧計 穩定 重測 spo2 oxygen measurement quality oximetry oximeter", OXIMETER),
        chunk("limits", ("Interpreting a reading", "解讀單次量測"),
              (("Circulation, skin pigmentation and temperature can affect the estimate. Consider changes "
               "in symptoms as well as numbers. For serious or worsening symptoms, seek medical help."),
               "循環狀況、膚色及皮膚溫度都可能影響估計值。解讀時一併留意症狀變化，症狀嚴重或惡化應尋求醫療協助。"),
              "血氧 膚色 溫度 誤差 準確 症狀 可信度 pulse oximeter accuracy symptoms", OXIMETER),
    ]),
    document("training-recheck", ("Synthetic heart-rate training rule", "合成心率訓練規則"),
             "education", "training-rule", "simulation", CREW,
             ("Explain the local simulator's notifications.", "了解本機模擬器發出通知的條件。"), [
        chunk("trigger", ("What triggers a notification?", "什麼情況會發出通知？"),
              (("TRAINING_HR_RECHECK v1 evaluates good-quality live synthetic resting heart rate. Three "
               "successive one-second buckets above 110 bpm trigger a training notification. The simulator "
               "uses this threshold to demonstrate a recheck request."),
               "TRAINING_HR_RECHECK 第 1 版採用品質良好的即時合成靜息心率。連續三個一秒時間桶均高於 110 bpm 時觸發訓練通知，用於演練重測。"),
              "心率 靜息心率 模擬 合成 感測警示 通知 規則 心跳 train training alert recheck mock heart rate threshold training_hr_recheck", RULE),
        chunk("clear", ("When can it trigger again?", "何時可再次觸發？"),
              (("The same high-rate episode sends one notification. Three successive valid buckets at "
               "110 bpm or below clear the condition, allowing a future episode to send a new notification."),
               "同一段持續異常只發一次通知。連續三個有效時間桶回到 110 bpm 以下（含）後，新的異常才會再次發出通知。"),
              "解除 恢復 持續 通知 心率 recovery training alert recheck", RULE),
    ]),
]
