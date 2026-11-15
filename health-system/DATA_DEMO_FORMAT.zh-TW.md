# 五人合成示範資料包 v3

本包只含虛構成年人與合成觀測，供訓練介面及程式驗證使用。沒有真實個資，不提供臨床判斷。生成器不連線、不使用密鑰，也不會修改資料庫。

在 `health-system` 執行：

```powershell
.\.venv\Scripts\python.exe demo_dataset.py generate --output ..\output\health-demo-v3\crew-demo-v3.zip
```

固定種子 `20261115`、排序、JSON 編碼及 ZIP 時戳，確保同一生成器產生逐位元相同的 ZIP。ZIP 根目錄只有下列九個檔案，禁止其他路徑、重複名稱、符號連結或加密項目；壓縮檔及展開資料各不超過 512 MiB。

| 檔案 | 結構／筆數 |
| --- | --- |
| `manifest.json` | `schemaVersion: crew-demo/1`、`datasetId: crew-demo-v3`、seed、synthetic、liveDurationMs、files |
| `profiles.json` | 5 個基本資料物件的陣列 |
| `body.json` | `{scans: [...]}`，25 次身體掃描 |
| `radiation.json` | 5 個歷史曝露檔案、30 天環境端點、即時背景率 |
| `activities.json` | 5 個人的連續活動時段 |
| `expected.json` | 一個獨立計算的驗收答案物件；僅限測試使用 |
| `history.jsonl` | 216000 封觀測包，30 天、每人每分鐘一包 |
| `live.jsonl` | 1505 封觀測包，每人每秒一包，含第 0 與第 300 秒 |
| `assessments.jsonl` | 900 次歷史及 26 次即時完整觀察 |

manifest.files 的各項為 `{sha256, count}`，雜湊涵蓋原始 UTF-8 位元組及 JSONL 行尾。JSONL 一行一物件、必須以換行結束；每行至多 1 MiB。小型 JSON 檔至多 8 MiB。讀取與雜湊採串流，不將歷史全部載入記憶體。

## 人員與時間

穩定人員 ID 是 `mira`、`kai`、`lin`、`noa`、`sol`，顯示名稱沿用既有帳號的 Mira、Kai、Lin、Noa、Sol。基本資料含 `dateOfBirth`、`heightCm`、`experienceYears`、`synthetic:true`，並為病史、用藥、過敏各提供 `{status: none_reported, items: []}`。這是虛構資料的明示設定。

所有時間都是整數相對毫秒。歷史 `tMs` 從 `-2592000000` 到 `-60000`，間隔 60000；即時從 0 到 300000，間隔 1000。同時刻依上述五人順序排列。準備匯入時，將負值加到 preparedAt；播放時，將非負值加到 startedAt。資料包不預先寫死真實日期。

觀測包結構為 `{id, crewId, tMs, metrics}`。ID 分別為 `h:{crewId}:{tMs}` 與 `l:{crewId}:{tMs}`。metrics 使用實際後端 `Metric` 契約：HR、SpO₂、RR 每包都有；SBP、DBP、體溫在歷史每四小時、即時每分鐘提供，另有 Sol 第 200 秒。單位依序 `/min`、`%`、`/min`、`mm[Hg]`、`mm[Hg]`、`Cel`。方法為 `synthetic-training-v3`，匯入來源為 mock 合成資料。

所有指標 context 都有 activity 及數值型 `analysisCadenceSeconds`；比較序列時不使用 cadence 作為鍵。HR／SpO₂／RR 歷史 cadence=60、即時=1；BP／體溫歷史=14400、即時=60。另依契約提供手指部位、坐姿、口溫及 RR 60 秒觀察時間。Kai 恢復期量測 activity 仍為 exercise，活動展示則顯示 recovery。每日歷史第 18 小時有 60 分鐘運動資料；靜息參考與運動資料分開。

## 身體、輻射與完整觀察

`body.json.scans` 沿用 `BodyImportScan`，只將 observedAt 改成 `observedMs`，finding.onsetAt 改成 `onsetMs`。每人在第 1、8、15、22、30 天各一次，含 22 區、總量、明示合成來源；區域肌肉及脂肪總和與總量一致。五分鐘播放期間沒有身體組成變化。Kai 的虛構左大腿訓練傷有固定 onset，後續掃描為恢復與解除。

`radiation.json.profiles[]` 含 crewId、experienceYears 與 priorExposure；曝露沿用 HistoricalExposure，只將 startAt/endAt 改成 startMs/endMs。年資依序 5、3、10、1、8；既往曝露天數為 40、30、120、10、90，劑量為 72、54、216、18、162 mSv。既往任務終於 preparedAt 前 31 天，與新的 30 天環境紀錄分開。環境背景為 75 µSv/h，30 天為 54 mSv；即時另累積 300 秒為 0.00625 mSv，不加入 NEWS2 分數。

完整觀察是 `{id, crewId, tMs, phase, inputs, poorQuality, observationStartMs, observationEndMs}`，ID 在觀測包 ID 前加 `a:`。inputs 符合現有 NEWS2 Inputs，使用 scale1、意識 A、無補氧及口溫。runtime 必須連結同一人的實際量測 ID 後再評分；不得讀取 expected 答案。即時首次完整觀察在第 60 秒，之後每 60 秒一次，另有 Sol 第 200 秒。每次 RR 視窗為 `[tMs-60000,tMs]`；未完成第一分鐘之前，滾動合成 RR 不構成完整觀察。

## 五分鐘腳本與驗收

Mira 保持穩定。Kai 在 60–119 秒運動、120–179 秒恢復，180 秒起回到靜息。Lin 在 120–209 秒的靜息 HR=112，第 210 秒恢復；第 180 秒 RR=24、SpO₂=93、SBP/DBP=105/70、HR=112、體溫=38.2，其獨立 NEWS2 答案為 8；心率警報預期在第 122 秒進入、第 212 秒解除。Noa 的 HR 在第 120–240 秒由 72 漸升至 84，NEWS2 HR 元件維持 0，可用來展示個人基線偏移。Sol 的 HR／SpO₂ 在 180–194 秒 poor、195–209 秒 missing，210 秒恢復；第 200 秒完整觀察必須維持不完整。

expected 包含固定參考窗 `[-14天,-7天)` 的 30 組靜息均值、樣本標準差與筆數，即時評分、Z/EWMA 檢查點及分段相對次數，以及警報和輻射答案。每組至少 42 筆有效觀察、至少 30 個不同數值且標準差大於 1e-9。生成器使用自己的 Welford 統計、NEWS2 區間及 EWMA 計算，沒有匯入正式評分或基線函式。EWMA λ=0.2；品質不良、cadence 改變或間隔超過四倍 cadence 時重開分段。分段 ID 由 runtime 產生，expected 只比較相對偏移。新一輪播放的第一點應重設分段。

## 後端讀取 API

```python
from backend.demo_bundle import DemoBundle, body_import_payload, radiation_import_payload

with DemoBundle(path) as bundle:
    manifest = bundle.validate()  # 必須在任何資料庫寫入之前執行
    profiles = bundle.json('profiles.json')
    for packet in bundle.rows('history.jsonl'):
        pass  # 呼叫端以串流方式匯入
    body = body_import_payload(bundle.json('body.json'), prepared_at)
    radiation = radiation_import_payload(bundle.json('radiation.json'), prepared_at)
```

轉換後的 body／radiation 可直接交給既有 BodyImport／RadiationImport 驗證。`activity_at(crewId, elapsedMs)` 回傳 crewId、activity、next、phase、phaseStartMs；phaseStartMs 固定由劇本決定，供 3D 平滑轉場。驗證器檢查 SHA-256、實際筆數、順序、時間、單位、來源契約、掃描排程、輻射一致性及活動連續性，不擷取 ZIP 至檔案系統。

驗證指令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_demo_dataset.py -q
.\.venv\Scripts\python.exe -m mypy demo_dataset.py backend/demo_bundle.py
.\.venv\Scripts\python.exe -m ruff check demo_dataset.py backend/demo_bundle.py tests/test_demo_dataset.py
```
