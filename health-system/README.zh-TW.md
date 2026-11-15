# 船內健康監測系統

[English](README.md) | **繁體中文**

這是船內健康監測 App 的本機訓練版。五位虛構船員可以記錄四項生命徵象、執行每日訓練、詢問個人健康紀錄、查閱急救教材及一鍵通知其他船員。指定的感測訓練情境也會自動發出通知。

## 在 Windows 啟動

使用 Python 3.12、Node.js 24 與 npm。於本資料夾開啟終端機，首次執行以下指令安裝相依套件並建置前端。

```powershell
.\setup.cmd
.\start.cmd
```

之後只需執行 `start.cmd`。FastAPI 在單一連接埠提供頁面、API 和 SSE，關閉服務可按 Ctrl+C。啟動時量測資料可以是空的，手動輸入與 Mock 均可獨立使用。

| 入口 | 測試帳號 | 可執行操作 |
| --- | --- | --- |
| [船員個人端](http://127.0.0.1:8000/app) | `mira`、`kai`、`lin`、`noa`、`sol` | 登錄量測、一鍵求助、接收團隊緊急通知 |
| [每日訓練](http://127.0.0.1:8000/app/tasks) | 船員帳號 | 計時、補登、量測、自評、查看個人徽章與七日進度 |
| [個人健康趨勢](http://127.0.0.1:8000/app/trends) | 船員帳號 | 選時段、來源和方法，看四項生命徵象的曲線、前期比較與原始量測 |
| [身體全息圖](http://127.0.0.1:8000/app/body-map) | 船員帳號 | 旋轉立體人體、查看肌肉脂肪和傷勢、保存模擬掃描與比較歷史 |
| [NEWS2 健康評估](http://127.0.0.1:8000/app/news2) | 船員帳號 | 建立一次觀察、連結量測、分次補登，查看缺項並詢問健康助手 |
| [健康助手](http://127.0.0.1:8000/app/assistant) | 船員帳號 | 以繁體中文或英文詢問本人紀錄、連續追問、開啟原始證據 |
| [急救指引](http://127.0.0.1:8000/app/first-aid) | 船員帳號 | 開啟本機雙語急救訓練卡，需要時通知全員 |
| [系統總覽](http://127.0.0.1:8000/system) | `monitor` | 查看全員數值、量測歷史與緊急通知 |
| [全螢幕看板](http://127.0.0.1:8000/board) | `display` | 唯讀查看四項指標與緊急通知 |

預設訓練密碼為 `orbital-demo`。可在啟動後端前設定 `HEALTH_DEMO_PASSWORD`。預設服務只監聽 `127.0.0.1`。同時展示角色時，請用不同的瀏覽器或獨立瀏覽器設定檔登入，各自保有獨立的 session Cookie。

## 試跑第一筆量測

1. 以 `mira` 登入個人端，以 `monitor` 在另一個瀏覽器登入系統端。
2. 在個人端選 **Record measurement → Blood pressure**，輸入收縮壓 `118`、舒張壓 `76`，核對姿勢與時間後預覽並儲存。
3. 查看系統總覽的 Mira 列，再開啟 Mira 詳情檢查歷史。兩個數值保留同一組量測 ID（`measurementGroupId`），各有自己的量測紀錄 ID。
4. 在另一個終端機送一批合成量測，觀察總覽如何更新。Mira 的血壓預留給人工輸入。

```powershell
.\.venv\Scripts\python.exe mock_adapter.py --once
```

省略 `--once` 可按預設頻率持續傳送，按 Ctrl+C 停止。完整選項可執行 `mock_adapter.py --help`。同機啟動的後端與 Mock 共用本機產生的裝置金鑰；自訂 `HEALTH_DB_PATH` 或 `HEALTH_MOCK_SECRET` 時，請讓兩個終端機使用相同設定。

目前卡片對心率、血氧優先顯示 Mock，對血壓、體溫優先顯示人工輸入。主要來源尚無資料時才顯示另一來源。若儲存後看到的卡片數值與剛才輸入的數值不同，可在量測歷史查看所有來源。最近有效值只取同一來源與量測方法。

## 試跑緊急通知

1. 用兩個獨立的瀏覽器設定檔分別登入 Mira 和 Kai 的個人端。也可以另外用 `monitor` 開啟系統總覽。
2. Mira 在個人總覽按 **Request help**。後端確認保存後，同頁顯示發送成功。
3. 在 Kai 已開啟的畫面和系統端查看通知。通知顯示是 Mira 主動求助，以及發生時間。其餘船員也會收到同一則通知，稍後登入可查看近期通知。

同一台電腦可開三個獨立瀏覽器設定檔，依序以 `mira`、`kai`、`monitor` 登入。各畫面顯示已連線後，在 Mira 的個人總覽點一次「緊急求助」，Kai 的個人頁與監測站都會立即顯示 Mira、通知來源及相同發生時間。近期 50 筆可在重連後查看。

手機與電腦在同一個可信任 Wi-Fi 時，可於 PowerShell 將 `$env:HEALTH_BIND_HOST` 設成電腦的 Wi-Fi IPv4，再執行 `.\start.cmd`。手機開啟終端機列出的船員網址。一般 HTTP 區網可接收前景通知。使用前請設定 `HEALTH_DEMO_PASSWORD`，若電腦開啟防火牆，需允許該私人網路連到服務埠。可用 `HEALTH_PORT` 更換連接埠。

鎖定手機或關閉分頁後的系統通知使用 Web Push。請以裝置信任的 HTTPS 網址開啟服務；可用同源 HTTPS 反向代理，或設定 `HEALTH_TLS_CERT`、`HEALTH_TLS_KEY` 指向與區網網址相符的憑證與私鑰。iPhone／iPad（16.4 起）先把 App 加入主畫面，再從該圖示開啟。在已登入的裝置頁尾按「啟用裝置通知」並允許。伺服器和裝置須能連到瀏覽器的推播服務，通知到達時間也受作業系統影響。登出或登入階段到期會停止該裝置訂閱的派送。VAPID 簽署金鑰在本機資料庫自動建立，可用 `HEALTH_PUSH_CONTACT` 指定維運聯絡 URI。[WebKit 主畫面 Web Push 說明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

要測試自動通知，在獨立終端機執行第一個指令。保持接收端開啟，可以看到系統自行發出 Mira 的「訓練感測警示」。第二個指令讓模擬資料恢復。兩個指令各傳送四輪，以涵蓋連續啟動時可能共用的第一秒。

```powershell
.\.venv\Scripts\python.exe mock_adapter.py --scenario high --ticks 4
.\.venv\Scripts\python.exe mock_adapter.py --scenario recovery --ticks 4
```

`TRAINING_HR_RECHECK` 使用指定 Mock 的合成靜息心率。連續三個一秒資料桶高於 110 bpm 會發出一則訓練通知；持續命中同一段異常期間只發一次。連續三個有效資料桶回到 110 bpm 以下（含）後，再次觸發才會發出新通知。此設定用於展示通知功能。

## 每日訓練與健康助手

每個 UTC 日提供運動、人工量測與訓練後自評三項任務。首頁可開始或結束運動計時，也可補登分鐘數、更換課表內的活動或附原因略過。完成第一個、累積第三個及第七個運動日可取得徽章。預設每日 18:00 UTC 提醒一次，可延後 15 分鐘。系統總覽與看板顯示全隊的任務件數。自評、略過原因和聊天引用限本人查看。

在健康助手詢問「我今天完成了哪些訓練？」或「今天的靜息心率為什麼比昨天高？」。若有可比較的合成紀錄，助手會列出原始時間、數值與來源。可以展開引用或追問「你指的是哪一筆？」。需要查閱急救時，從首頁或對話開啟固定卡片。微重力 CPR 與地面外出血教材各自標示用途、版本與來源，兩張卡目前均為訓練教材。

FastAPI 從伺服器環境或本資料夾的 `.env.local` 讀取 `OPENAI_API_KEY`。瀏覽器僅連線到船內後端。預設模型為 `gpt-4.1-mini`，可用 `HEALTH_AI_MODEL` 覆寫。對話保存在本機。只有本次問題及相關合成證據會傳給雲端，私人自評備註不會自動帶入。若想演練斷網，在啟動服務前設定 `HEALTH_AI_OFFLINE=1`；本機摘要、急救卡和船內廣播仍可使用。

## 資料與 API

「個人健康趨勢」提供 1 小時、24 小時、7 天、30 天與自訂 UTC 區間。每組曲線保留相同來源、量測方法、活動／姿勢／部位及資料性質。缺值或品質不良會中斷曲線；點量測點或用下拉選單可展開原始紀錄。資料密集時，每個繪圖時間格保留首末、最高及最低點，全部有效樣本仍參與計算。

心率、血氧、呼吸頻率、收縮壓、舒張壓與體溫皆支援固定個人基準：在趨勢頁檢視七天同條件樣本，再按「建立固定基準」。至少需 30 筆有效樣本及大於 `1e-9` 的樣本標準差。每組指標、來源、方法、單位與情境同時只有一個現行版本；每版的樣本 ID、期間、平均及標準差永久保存。切換圖表或助手查詢不改寫基準。

建立時會分析截止時間之後已有的同條件量測，後續手動、即時及匯入量測在寫入交易內保存分析。`fixed-baseline-v2` 計算 Z-score 與 EWMA（權重 0.2），保存量測、基準版本、分段及算法版本；既有 v1 紀錄不改寫。品質不足、取樣間隔改變，或空檔超過 `context.analysisCadenceSeconds` 的四倍時另起一段。cadence 是中繼資料，不作為比較序列的鍵；靜息與運動分開。模擬資料每 UTC 秒只採第一筆有效代表。晚到資料與同秒重複樣本保留明確狀態，不改寫既有 EWMA。

「基準版本與審核」支援候選、明確啟用、排除期間、重建、凍結／解除、身體不適標記及停用，保存原因與操作歷史。首次候選也可先排除再審核；排除會淘汰未啟用候選。凍結仍以固定參數分析，替換前須明確解除；既有相關心率警示會自動凍結相同序列，清除警示不自動解除。未核准的實測資料不套用訓練設定。

展開量測點的「來源與量測資料」再按「詢問助手這筆分析」，查詢攜帶同一不可變 `analysisId`。「另存重算修訂」只對選定單筆建立新 ID、`analysisRevision` 與獨立 EWMA 段，不改寫歷史或即時序列。趨勢數值對應該分析當時使用的基準，現行版本另行標示。總覽並列 NEWS2、六項統計、身體與輻射；缺值不當成零，不產生綜合健康分數或臨床判定。

船員私有 API：`POST /v1/baselines`（`commandId`、本人 `measurementId`、`referenceTo`，需 CSRF）、`GET /v1/baselines/{id}`、`GET /v1/analyses/{id}`；助手查詢可指定 `analysisId`，引用可透過 `/v1/assistant/records/analysis/{id}` 讀取。新表沿用原 SQLite；原有資料可繼續讀取，不自動啟用基準。

版本 API：`GET /v1/baselines?measurementId=...`、`POST /v1/baselines/candidates/new`、`POST /v1/baselines/{id}/actions`、`POST /v1/analyses/{id}/recalculate`。新命令需 CSRF、`commandId`、`expectedRevision` 與原因；候選另帶量測 ID 與截止時間。重啟時附加新表，既有基準／分析 JSON 不改寫。

### 三層評估報告

在 NEWS2 頁按「保存三層評估」，固定保存選定評估版本、精確連結量測的分析／基準、規則判定與當時警示、時間／品質／來源限制，以及知識／程序版本。手填值不借用其他量測的統計；舒張壓不屬 NEWS2 連結範圍，會明確標示。沒有 NEWS2 時，各指標最新量測分別呈現可比較性限制。

「詢問助手這份報告」使用同一 `reportId`；追問保留快照，明確的新任務或量測問題可切換主題。模型不能更改分數、必備證據或引用；離線、逾時或驗證失敗回退本機事實，保存模板、模型與驗證資訊。`POST /v1/health-reports` 使用 `commandId` 及可選評估 ID／版本；GET 列表供本人／監測站讀摘要，完整報告及助手來源僅本人可讀，公共看板不可讀。重試不重複保存，GET 不重算，後續變更不改寫舊報告。

Windows 預設資料庫位於 `%LOCALAPPDATA%\NasaHealthSystem\training.sqlite3`。若要改用特定資料庫，可在啟動服務前將 `HEALTH_DB_PATH` 設為本機非同步資料夾中的完整檔案路徑。一般工作區使用 `runId=null`，量測成功後才會同步至其他畫面。瀏覽器以 session 驗證，人工寫入另需 CSRF token，Mock 使用個別裝置 Bearer 憑證。

### 已儲存紀錄快照（2026-11-15）

[資料庫快照 ZIP](examples/training-records-20261115.zip) 保存當時本機資料庫的 650,930 筆量測、30 組固定基準、145,530 筆統計分析、900 筆 NEWS2 版本、25 筆身體掃描及其他已儲存紀錄。[驗證清單](examples/training-records-20261115.manifest.json) 列出各表筆數、保留紀錄的指紋、SHA-256 與完整性檢查結果。這是固定時間的合成訓練紀錄快照，後續本機操作不會自動更新 Git 中的檔案。

快照已移除登入 session、推播訂閱／待送佇列及本機簽署金鑰，保留的紀錄與匯出副本逐表比對一致；展示包路徑改為儲存庫相對路徑。還原後需重新登入及啟用裝置通知，金鑰由程式在本機重新建立。

ZIP 使用 LZMA 壓縮，請用下列 Python 指令解壓縮。完成首次安裝後，在 `health-system` 資料夾的 PowerShell 執行，解壓縮至新的本機目錄並啟動。解壓縮後需要約 1.3 GB 空間；若目的目錄已存在，請換新名稱，以保留既有資料。

```powershell
$restore = Join-Path $env:LOCALAPPDATA 'NasaHealthSystem\snapshot-20261115'
New-Item -ItemType Directory -Path $restore -ErrorAction Stop | Out-Null
.\.venv\Scripts\python.exe -m zipfile -e .\examples\training-records-20261115.zip $restore
if ($LASTEXITCODE -ne 0) { throw '資料庫快照解壓縮失敗。' }
$env:HEALTH_DB_PATH = Join-Path $restore 'training-records-20261115.sqlite3'
.\start.cmd
```

可在 [API 文件](http://127.0.0.1:8000/docs) 查看端點，或在 [readiness](http://127.0.0.1:8000/v1/health/ready) 查看後端、知識庫及模型設定狀態。

### NEWS2 健康評估

1. 以 Mira 開啟「NEWS2 健康評估」，填同一次觀察的 UTC 時間。可直接登錄呼吸頻率、心率、血氧、收縮壓、體溫，也可逐項連結既有量測。呼吸頻率連結會沿用原始 `context.observationDuration` 秒數；不能用手填秒數覆蓋連結紀錄缺少的資料。
2. 補登呼吸觀察秒數（手填呼吸頻率時）、意識狀態（ACVPU，C 為新發混亂）、呼吸環境空氣或接受補氧，以及醫療人員指定的血氧尺度。尺度 2 必須明確選擇並確認有臨床指定紀錄，系統不會從血氧值自動推定。直接登錄體溫也要記錄部位和方法。可先儲存部分資料。[RCP 官方 NEWS2 計分表](https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf)
3. 儲存後查看「訓練 NEWS2 總分」與「已保存分項計分」。8/8 仍表示八項必要輸入完整；七個分項為六項生理參數加補氧分數，血氧尺度屬於計分設定。缺項、品質不足或超出時間窗時，已知分項仍顯示，完整總分為空；「—」不代表 0 分。
4. 按「詢問助手這次 NEWS2 評估」並送出。助手引用已保存版本的分數、規則版本與缺漏資料，回答可展開當時的原始評估。日後補登產生新版本，先前引用不會改寫。監測站同步顯示最新評估摘要；完整紀錄限本人讀取，其他船員與唯讀大螢幕無法讀取。

展示版以觀察時間前後五分鐘為量測分組範圍，屬於訓練工程設定。計分預設版本為 `rcp-news2-2017-training-v1`。啟動前設定環境變數 `HEALTH_NEWS2_PROFILE=disabled` 可停用新紀錄計分；未知版本也不計分、不回退預設值。未設定時使用預設版本。重新啟動服務後生效，表單會透過 `/v1/news2/config/current` 顯示目前設定。

每次儲存會一起保存 `componentScores`、`news2Score`、`scoringInputs`、`ruleSetVersion`、`normalizationVersion` 與設定狀態；變更設定、重新啟動或重送同一請求不會重算既有版本。舊版僅有完整度的紀錄維持原狀；要計分須另存新版本。

本系統的 `decimal-half-up-v1` 訓練輸入政策將呼吸頻率、血氧、收縮壓與心率四捨五入至整數，體溫至 0.1°C；例如 18.5 次／分以 19 計分。原值與計分值均保留，畫面可分別查看。此小數處理是本系統的工程政策，並非 RCP 的小數量測規範。所有結果僅供合成資料訓練，不作臨床分級、診斷、處置或自動通報。

計分來源：Royal College of Physicians, *National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS*, 2017。中文說明未經 RCP 特別核准；請以英文原始文件為準。[尺度 2 的指定條件與補充說明](https://www.rcp.ac.uk/media/umzn4ntq/news2_additional-guidance-002-_0.pdf)

新 NEWS2 紀錄也保存單項 3 分、`riskBand`、`interpretationVersion` 與 [RCP Chart 2](https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf) 來源。缺總分不指定整體級別；舊分數的圖表對照會明示「原紀錄未保存分級」。此訓練顯示不新增通報或臨床處置。

手機版 NEWS2 也可在儲存觀察後按「保存三層評估」。視覺趨勢頁的「個人基準與詳細分析」可開啟候選審核、版本管理及已保存分析引用，再以「返回趨勢摘要」切回簡潔圖表。

## 身體全息圖：一分鐘展示

新版畫面標示 `HOLOGRAPHIC / 02`：人體使用透明發光輪廓、點陣與掃描線，腳下有立體投影環及光束。右上「全息投影」可暫停／播放投影動態；系統開啟「減少動態」時預設靜止。人體仍由手勢控制角度，不自動旋轉。修改原始碼後須執行前端 build 並重新載入頁面，既有分頁不會自動換成新的 JavaScript。

1. 執行 `start.cmd`，以 `mira` 登入，從首頁「我的身體」卡片進入。首次尚無掃描時，先選「日常基準」並按「模擬掃描」。
2. 選「訓練後・拉傷」再掃描，切換「肌肉」，點選人體左大腿。可旋轉、雙指縮放、切正背面，也可用部位選單選取。手機上點選後，模型旁會顯示該部位的肌肉、脂肪量；下方詳情顯示傷勢程度、狀態與時間。
3. 切換「脂肪」，再選「恢復觀察」掃描。開啟「歷史比較」選擇前一筆，展開「比較與掃描細節」查看目前值、比較值及差量。回看歷史時，人體和傷勢使用同一筆當時快照。
4. 選「部分資料缺少」可展示缺值：左前臂與背部無可用分區讀值，顯示破折號，不當成零。重新整理保留已保存掃描；其他帳號只能讀取自己的掃描。

這些是固定情境的合成資料，畫面持續標示「模擬資料」。全身體脂率以脂肪量／身體質量計算，分區只顯示 kg。掃描獨立於原有生命徵象與 NEWS2，不需要啟動演練；`runId=null`。伺服器保存不可變快照；回應遺失後重試同一個請求不會新增重複掃描。斷線保留本頁最後取得的資料；首次離線開頁需要恢復連線才能讀取。

本機 `start.cmd` 預設開啟掃描展示。設 `HEALTH_BODY_SCAN_DEMO=0` 可關閉新增；直接以 uvicorn 啟動時須明確設定 `HEALTH_BODY_SCAN_DEMO=1` 才能新增。已有紀錄仍可閱讀。API 為 `/v1/body-scans/latest`、`/v1/body-scans`（游標分頁）、`/v1/body-scans/{id}`、`POST /v1/body-scans/demo`，限本人 session，寫入另檢查 CSRF。

人體模型為本專案原創 22 區 GLB（約 1.94 MB、26,764 三角形），來源與 CC0 授權見 `web/public/body/LICENSE.md`；重建指令為 `node tools/create-body-model.mjs`、`node tools/create-body-preview.mjs`（在 `web` 執行）。首頁只載入靜態預覽，進入人體頁才載入 Three.js。WebGL／模型失敗時降級為可選部位的平面圖，資料與比較仍可操作。

前端執行 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`，再執行 `npm.cmd run test:body`。人體瀏覽器測試使用獨立臨時資料庫，涵蓋 360、390、430px、橫向與桌面。這些是 Chrome 視窗與觸控模擬，真實手機的 Safari、捲動手感及持續旋轉效能仍須實機確認。

## 太空輻射監測

首次授權開啟網頁會建立一個共同監測任務。Lin／Kai／Mira／Noa／Sol 的虛構歷史暴露分別為 216／162／72／18／288 mSv；這些值來自明列的深空展示任務天數。之後全員依同一個 75 μSv/h 背景共同增加，每一實秒對應一監測秒。瀏覽器不自行積分；換人、重新整理或關頁重開都沿用 SQLite 保存的任務。全部網頁關閉後，運作中的後端仍持續累加。

個人總覽拆分歷史／共同新增／合計；監測站顯示五人，唯讀看板只顯示公共環境及共同新增。監測帳號可在「模擬事件控制」啟動 150 μSv/h 的 elevated 或 750 μSv/h 的 SPE，結束後回到背景但不減少累積。這些都是 Simulation，不是醫療安全門檻；不會改變生命徵象或 NEWS2。

資料存於既有 `HEALTH_DB_PATH`。首次升級舊資料庫時，會先用 SQLite backup API 在同資料夾建立 `*.before-radiation.sqlite3`。正常關閉後端會保存最後進度；異常終止恢復最後成功 checkpoint，停機期間不外推。開發測試請使用不同的 DB 路徑，不要刪除日常資料庫來重播展示。

輻射子契約為 `radiation/1`，舊 telemetry 1.2／1.3 不變：

- `GET /v1/radiation/current?view=personal|system|system_display`：授權快照；也包含在既有 `/v1/snapshot` 和 `radiation.updated` SSE。
- `GET /v1/radiation/environment?missionId=...`：可分頁的環境率區間；`fromMs`／`toMs` 是共同任務時間。
- `GET /v1/radiation/crew/{crewId}` 與 `/history`：本人或監測站讀取。
- `POST /v1/radiation/demo-event`：monitor＋CSRF，帶 `commandId`、`expectedControlVersion`、`action` 和 `preset`／`eventId`；同 ID 重試不重複執行。
- `POST /v1/radiation/samples`：外部 JSON 來源模式的 monitor＋CSRF 輸入。封包帶 `missionId`、`sourceId`、`messageId` 及 `sample`；sample 使用 `timestamp`、`missionElapsedMs`、`radiation_rate_usv_h`、`cumulative_radiation_msv`、`radiation_event`、`is_simulated=true`。

預設 `HEALTH_RADIATION_ENABLED=1`、`HEALTH_RADIATION_SOURCE=simulation`。新任務若要接 JSON，啟動前設定 `HEALTH_RADIATION_SOURCE=json` 與 `HEALTH_RADIATION_SOURCE_ID`（預設 demo）；已存在任務不切換來源。外部 cumulative 是「本次共同新增」，不含個人歷史，提供後以來源為準、不再重複積分。逆序／衝突回 409，缺值或中斷明示；率樣本間隔超過 5 任務秒不補算，5 實秒無更新標過期。首版僅接受模擬資料。


## 匯入展示用歷史資料

### 30 天歷史與五分鐘播放

[v3 資料包](../output/health-demo-v3/crew-demo-v3.zip) 遵循[合成資料契約](DATA_DEMO_FORMAT.zh-TW.md)，含五位虛構船員、216,000 包歷史量測、900 筆歷史 NEWS2 觀察、25 次身體掃描，以及 300 秒的 1,505 包即時資料。從儲存庫根目錄建立新候選資料庫：

```powershell
.\health-system\.venv\Scripts\python.exe .\health-system\demo_prepare.py --dataset .\output\health-demo-v3\crew-demo-v3.zip --output "$env:LOCALAPPDATA\NasaHealthSystem\crew-demo-v3-candidate.sqlite3"
```

`--dataset`、`--output` 為必要參數。準備程序先驗證 ZIP，拒絕覆蓋既有目標或 `.building`，並以 `[preparedAt − 14 天, preparedAt − 7 天)` 建立五人各六組靜息基準，共 30 組。這個指令不替換目前服務使用的資料庫；再次準備須用新的候選路徑，保留既有紀錄與 session。

醫療服務使用已準備的資料庫後，開啟 3D 的 `/playback.html`，以 `monitor` 登入並按「開始新的示範」／「停止示範」。每次開始由後端執行單次 300 秒播放，完成後保留已保存結果；重新整理或關閉控制頁不會重啟或停止。連線模式沒有自動循環、暫停或倍速。先停止其他傳送器；播放中後端會拒絕其他 mock 輸入。

歷史結束於 `preparedAt − 60 秒`，即時資料從實際 `startedAt` 開始。兩個時間錨點獨立，中間的真實空檔不補值、不重寫時間。摘要區分已保存歷史、本次回放與過期／未提供資料。五分鐘內身體組成不變，輻射獨立累積，不加進 NEWS2。

`GET /v1/demo/playback` 限已登入 session；`GET /v1/demo/profile?crewId=...`、`/v1/demo/assessment?crewId=...` 限本人或 `monitor`，後者回傳基本資料、播放狀態、六項基準、已保存 NEWS2、身體與輻射摘要。`POST /v1/demo/playback/start`、`/stop` 需 `monitor`＋CSRF，內文為 `{commandId}`；公共看板無法讀取個人基本資料。包內 expected 答案僅供測試，不作 runtime 輸入；合成範例不證明臨床準確度、真實裝置送達或部署驗收完成。

### 獨立歷史 JSON 匯入與舊版 CLI

以 `monitor`／`orbital-demo` 登入 `/system`，在資料匯入區選擇 [crew-dataset.example.json](examples/crew-dataset.example.json)，檢查摘要後按匯入。JSON 格式為 `crew-dataset/1`，支援生命徵象、身體掃描與輻射封存；上限 32 MiB。相同 datasetId 與內容重送不會重複建立，內容不同需換新的 ID。資料必須是歷史時間，不接受未來量測。匯入會寫入目前的資料庫；如要獨立展示，可先設定不同的 `HEALTH_DB_PATH`。

[舊版 60 秒 ZIP](../astro-hiyoko-demo/data/crew-health-sample60.zip) 保留供 `dataset_player.py --dataset ... --inspect` 或獨立 CLI 傳送器使用，每輪 300 包、1,215 筆指標。目前 3D 的 `/playback.html` 不再讀取該檔。舊版 ZIP、v3 `crew-demo/1` 與 `crew-dataset/1` 歷史 JSON 是不同格式，不可互換。
