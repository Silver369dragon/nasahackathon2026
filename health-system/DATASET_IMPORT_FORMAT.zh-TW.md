# 五人健康輻射與身體資料生成規格

版本 2.0　2026-11-14　Single-file synthetic dataset

資料組只交付 **一份 `dataset.json`**，包含五人的生命徵象、年資與過往輻射暴露、共用輻射時間序列，以及身體組成與傷勢。軟體端統一驗證並分發，資料組不用另拆 CSV、JSONL 或五份個人檔。這份規格是新增單檔匯入入口的契約；先前 DATA_GENERATION_HANDOFF.zh-TW.md 的 JSONL 是舊播放器格式，不能直接上傳此入口。

本入口是**歷史資料匯入**，不會等候劇本時間逐秒播放，也不觸發即時心率緊急通知。以下劇本由資料時間排序呈現；若需要現場即時演出，仍使用原本 telemetry／輻射即時 API。匯入不修改正在執行的輻射任務時鐘、事件或累積量。

## 1 交付方式與格式

以 UTF-8 JSON 交付，最大 32 MiB；僅有限數值，不使用 NaN、Infinity、數字字串。所有時間為 UTC ISO 8601（結尾 Z），不得晚於匯入當下。範本固定以 T0=2026-11-01T00:00:00Z 排程，實際生成可以更換 T0，但整段展示結束必須已經過去。

| 根欄位 Field | 型別 Type | 規則 Rule |
|---|---|---|
| schemaVersion | string | 固定 crew-dataset/1 |
| datasetId | string | 1～80 字元；首字英數，其餘英數、底線或連字號；同檔重送保留 ID，內容改變必須新 ID |
| radiation | object，可省略 | profiles 與 environment，見第 4 節；本次完整交付必填 |
| body | object，可省略 | scans 陣列，見第 5 節；本次完整交付必填 |
| measurements | array，可省略 | 生命徵象樣本；本次完整交付必填，上限 16,000 筆樣本 |

API 可接受部分模組，但至少一個非空模組。本次資料組請交付三個模組齊全的檔案。不要加入 root 的 README、情境名稱、seed 或未知欄位；API 嚴格拒絕額外欄位。完整可用範例為 `examples/crew-dataset.example.json`，可直接照該檔修改。

## 2 五個人物與差異

| crewId | 年資 experienceYears | 過往太空暴露天數 | 歷史劑量 mSv | 身體劇本 |
|---|---:|---:|---:|---|
| mira | 5 | 40 | 72 | 穩定對照，無傷 |
| kai | 3 | 30 | 54 | 右上臂輕度瘀傷，之後恢復中 |
| lin | 10 | 120 | 216 | 左大腿中度拉傷，之後輕度、恢復中 |
| noa | 1 | 10 | 18 | 無外傷，肌肉量相對自己的基準逐步減少 |
| sol | 8 | 90 | 162 | 左前臂輕度擦傷，追蹤時仍作用中；另有量測品質情境 |

年資是背景資料，不是持續在太空的時間，也不直接決定輻射量。此表歷史暴露使用 75 μSv/h 的虛構固定參考率：doseEquivalentMsv = referenceRateUsvH × exposureDays × 24 / 1000。這些數值僅為展示設定，不是 NASA 的安全界線或真實人物資料。

## 3 生命徵象 measurements

每筆樣本為 `{id, crewId, observedAt, metrics}`。id 為資料集內唯一字串；crewId 固定上述五人；metrics 是下表項目的陣列。每項包括 code、value、unit、method、context、quality；血壓另需成對且使用同一 measurementGroupId。

| 指標 Metric | code | value 與單位 unit | 必要 context |
|---|---|---|---|
| 心率 Heart rate | heart_rate | number，/min | activity=rest 或 exercise |
| 血氧 SpO₂ | spo2 | number，% | measurementSite=finger |
| 收縮壓 Systolic BP | blood_pressure_systolic | number，mm[Hg] | posture=seated |
| 舒張壓 Diastolic BP | blood_pressure_diastolic | number，mm[Hg] | posture=seated |
| 體溫 Temperature | temperature | number，Cel | measurementSite=oral、temperatureType=oral |
| 呼吸頻率 Respiratory rate | respiratory_rate | number，/min | observationDuration=60（數值秒數） |
| 呼吸費力 Work of breathing | work_of_breathing | 本版 null，unit=1 | 空物件 {} |

method 全部固定 mock_generated。品質 quality 可為 good、poor、invalid、missing；poor/invalid/missing 必須附 qualityReason。missing 的 value 必須 null，不可用 0 代替。呼吸費力固定 null、missing、scale_not_configured，直到團隊確認量表識別、版本與分數意義。不得自行生出 0～10 的醫療分數。

| 人物 | 心率 /min | 血氧 % | 體溫 Cel | 收縮壓 mm[Hg] | 舒張壓 mm[Hg] | 呼吸 /min |
|---|---:|---:|---:|---:|---:|---:|
| mira | 68 | 98 | 36.6 | 116 | 74 | 16 |
| kai | 74 | 97.5 | 36.7 | 120 | 78 | 16 |
| lin | 70 | 98 | 36.5 | 118 | 76 | 16 |
| noa | 72 | 98.5 | 36.6 | 114 | 72 | 16 |
| sol | 66 | 97.5 | 36.7 | 122 | 80 | 16 |

一般片段圍繞基準小幅平滑變化：心率 ±2、血氧 ±0.5、體溫 ±0.1、收縮壓 ±3、舒張壓 ±2、呼吸 ±1。心率／血壓／呼吸取整數，血氧與體溫一位小數。每人使用不同曲線，歷史有效值不能全為常數。以上只控制合成劇本，不定義健康正常範圍。

歷史排程：七天每天六段、每段 60 秒；第 j 段（j=0…41）起點 T0−604800 秒+j×14400 秒，段內每秒一次。每秒含心率、血氧、呼吸與呼吸費力；每段首秒另有體溫及成對血壓。

展示排程：T0 至 T0+599 秒，每人每秒一次；每秒四項，逢 0、60、120…540 秒另含體溫及成對血壓。合計 15,600 筆五人樣本、63,180 個 metric，其中呼吸費力缺值仍計入。按 observedAt、mira/kai/lin/noa/sol 排序。

| 展示時間 t 秒 | 人物與生成內容 |
|---|---|
| 0～119 | 全員各自基準 |
| 120～149 | Kai 心率由 74 升到 115，activity=exercise；Lin 靜息心率 112 |
| 150～179 | Kai 維持活動；Lin 回到約 70 |
| 180～189 | Lin 再次靜息心率 112 |
| 190～299 | Lin 回基準；Kai 210 秒後逐漸恢復，300 秒回 rest |
| 240～249 | Sol 心率與血氧保留值，但 quality=poor、qualityReason=motion_artifact |
| 250～259 | Sol 心率與血氧 value=null、quality=missing、qualityReason=no_sample |
| 260 起 | Sol 恢復有效值；呼吸資料不受前述單項缺值影響 |
| 300～479 | Noa 靜息心率在原序列加上由 0 漸增至 12 的偏移 |
| 480～599 | Noa 維持基準+12；其餘沿用個人曲線 |

上述高值只是資料生成情境。歷史匯入不會製造即時警報。舊規格的斷線補傳情境不在此匯入入口執行，資料組不需自行實作網路分發。

## 4 輻射 radiation

profiles 必須恰好五人且不可重複，每人含 crewId、experienceYears（0～100 整數）、history（至少一筆）。history 各筆時間遞增且不可重疊，必須在 environment 第一個時間點之前結束。

| history 欄位 | 型別／單位／規則 |
|---|---|
| id | 同一人歷史內唯一，首字英數，其餘英數、點、底線、連字號，最多 128 字元 |
| missionLabel | 任務名稱字串，最多 200 字元 |
| startAt、endAt | UTC 時間，endAt > startAt，不可在未來 |
| exposureDays | number，天；必須等於起訖秒數÷86400 |
| referenceRateUsvH | number，μSv/h；該段固定參考率 |
| doseEquivalentMsv | number，mSv；率×小時÷1000 |
| isSimulated | 固定 JSON true |

quantity、unit、comparabilityKey 可省略，系統固定為 dose_equivalent_estimate、mSv、demo-dose-equivalent-v1。不得混入 Gy、日照強度或瓦特值。

environment 是五人共用的一條時間序列，最少兩點，最多 100,000 點。每點為 `{timestamp, rateUsvH, cumulativeMsv, radiationEvent, isSimulated:true}`。所有數值非負；時間嚴格遞增。第一點 cumulativeMsv=0；後續 `cumulative[i] = cumulative[i−1] + rate[i−1] × 相隔秒數 / 3600000`，允許誤差 0.000000001 mSv。請保留足夠小數（範本 12 位），不要每秒將累積量四捨五入為 0。

| 時間區間 | rateUsvH | radiationEvent |
|---|---:|---|
| [0,120) 秒 | 75 | background |
| [120,180) 秒 | 150 | elevated_exposure |
| [180,300) 秒 | 750 | radiation_event，代表合成太陽粒子事件情境 |
| [300,600] 秒 | 75 | background |

每秒一點，包含 600 秒結束點，共 601 點。此事件不會自動造成其他人的低血氧、受傷或肌肉流失；不要建立未經支持的生理因果關係。

匯入後，監控頁會顯示「這份資料集」的五人年資、歷史量與環境封存。原有輻射歷史保留，新歷史以追加方式保存；因此既有個人輻射總量會包含原本示範歷史及所有已匯入歷史，不能拿它當單一新檔的小計。相同資料換新 datasetId 會被視為新的追加資料，請勿藉此重複匯入同一歷史。

## 5 身體資料 body.scans

本次生成五人各三次掃描，共 15 筆：T0−30 天為基準、T0−7 天為異常／受傷追蹤、T0−1 天為恢復或持續追蹤。最多 5,000 筆；不接受 receivedAt，由系統保存接收時間。

| scan 欄位 | 型別及規則 |
|---|---|
| id | 該人於此資料集內唯一；不同日期不同 ID |
| crewId | 五個固定 ID 之一 |
| observedAt | UTC 掃描時間，不得在未來 |
| totals | bodyMassKg、muscleMassKg、fatMassKg；各為 number 或 null，kg，0～500 |
| regions | 必須有下列 22 區，每區含 muscleMassKg、fatMassKg、quality、missingReason |
| findings | 傷勢陣列；無傷為 []；每次最多 200 筆 |

schemaVersion=body-scan/1、mode=training、synthetic=true、source=mock、method=orbital-bioscan-v1、runId=null 可省略，後端補固定值。肌肉量與脂肪量各自及相加不得超過體重；體重不是肌肉加脂肪的同義詞，仍有其他組織。體脂率由 fatMassKg/bodyMassKg×100 計算，不另傳 fatPercent。

22 區代碼：head、neck、chest、abdomen、pelvis、back；左右各 shoulder、upper_arm、forearm、hand、thigh、knee、lower_leg、foot，左右前綴為 left_、right_（例如 left_thigh）。

每區 quality=good 時肌肉與脂肪都必須有值，missingReason=null；quality=missing 時兩值均 null 且填原因；quality=poor 可保留值，但需原因。全部區域 good 時，每種組織的區域合計需接近全身總量，容許差異為 max(0.05 kg, 總量×1%)。不可為湊數把缺值改 0。

| findings 欄位 | 型別與允許值 |
|---|---|
| id | 同一傷勢跨日期沿用 ID，同次掃描不重複 |
| regionCode | 上述 22 區其中之一 |
| kind | strain 拉傷、bruise 瘀傷、abrasion 擦傷 |
| severity | mild 輕、moderate 中、severe 重 |
| status | active 作用中、recovering 恢復中、resolved 已解除 |
| onsetAt | UTC 發生時間，不得晚於該掃描 |
| functionalImpact | 非空簡短文字，例如 reduced_load、local_discomfort、improving_mobility |

| 人物 | 基準體重／肌肉／脂肪 kg | 第 2、3 次掃描安排 |
|---|---|---|
| mira | 70.2／32.4／14.8 | 總量穩定、findings=[] |
| kai | 72.3／33.6／15.5 | 右上臂 bruise，mild，active → recovering |
| lin | 74.4／34.8／16.2 | 左大腿 strain，moderate/active → mild/recovering |
| noa | 76.5／36.0／16.9 | 肌肉依序 36.0 → 35.2 → 34.8；體重對應 76.5 → 75.7 → 75.3；脂肪保持 16.9；無外傷 |
| sol | 78.6／37.2／17.6 | 左前臂 abrasion，mild，active → active |

三人的傷勢 onsetAt=T0−8 天。區域肌肉／脂肪分配需符合總量；Noa 可沿固定比例分配減量。這些是展示「與自己基準不同」的例子，不是臨床異常閾值。受傷資訊明確給定，不能從組成數字推導；擦傷、瘀傷也不必伴隨肌肉量減少。

## 6 使用入口與驗收

啟動新版後端與新版前端後，以 monitor 登入「全員總覽」，選擇唯一 dataset.json，檢視資料集 ID 和筆數，再按匯入。API 為 POST /v1/datasets/import，使用監控帳號 session 與 X-CSRF-Token，不是硬體 Bearer Token。不需把 Token 放入資料檔。

全檔先通過驗證，再於單一交易寫入；任何 section 錯誤皆不保存。同 datasetId 同內容重送回傳成功並標示重播；同 ID 不同內容回傳 409。伺服器會為身體掃描和傷勢生成資料集範圍的穩定儲存 ID；資料組保留自己原始 id 即可。

| 檢查 | 預期 |
|---|---|
| 完整範例 | 5 個輻射人物、5 筆歷史、601 個環境點、15 筆掃描、63,180 個生命徵象 metric |
| 重新上傳同檔 | 不增加筆數 |
| 改錯血壓單位／少一身體區域／錯累積劑量 | 整檔拒絕，無部分保存 |
| 非 monitor 匯入 | 拒絕；個人掃描仍只有本人可讀 |
| 輻射封存 | GET /v1/datasets/radiation?datasetId=檔案ID 可由 monitor 查看；不是即時任務替換 |
| 個人身體頁 | 各船員登入查看歷史掃描；最新依 observedAt 決定，匯入舊資料不應蓋過較新紀錄 |
| 個人趨勢 | 選涵蓋 T0 的自訂區間；歷史匯入不會冒充即時資料 |

睡眠時數、數字疲勞分數、CO₂、艙壓、環境溫濕度不在此次接收格式。NEWS2 與日常自評仍使用原有表單，不要塞入此檔未知欄位。資料組依這份契約生成即可，介面分發由軟體負責。
