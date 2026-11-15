# PR #4 手機資料與通知修正方案

> 執行者：依 superpowers:executing-plans 逐項實作；每項先確認回歸案例，再做最小修正。使用者已授權依方案實作，並追加授權：自我檢查通過後 commit、push 回原 PR 分支 ui/mobile-home-buttons，交由 Claude 審核；不合併。

**目標：** 保留 PR 的手機首頁與分頁操作方式，修正未讀通知遺失、預填量測、輸入範圍受限及跨日期誤讀。
**架構：** 延用 React 元件、既有 REST/SSE 與表單提交流程。修正在前端完成，保留後端的資料契約、品質標記、冪等命令與 NEWS2 完整度評估。
**技術：** React 19、TypeScript、Vite、Node test runner、Playwright；FastAPI 提供既有測試服務。
**規格來源：** 本輪使用者要求及 PR #4 的四項 review 建議。PR：https://github.com/Silver369dragon/nasahackathon2026/pull/4
**核對版本：** 26fc7306b5cd44f9772b35952b807bbb6e05e3c7，來源分支 ui/mobile-home-buttons。

## 全域限制

- 原工作區既有變更保持原樣；本輪依核准方案在獨立工作樹實作。
- 自動核准審查拒絕建立 ui/ 前綴的本機分支。改用 fix/mobile-data-safety，追蹤 origin/ui/mobile-home-buttons；初始 HEAD 與 PR 完全一致。
- 不更改後端 API、資料庫 schema、通知的業務處理流程，也不新增 NEWS2 分數。
- 保留繁中／英文切換、650px 手機切換規則、桌機輸入方式及品質／缺值紀錄能力。
- 每項先重現問題，再修正、驗證；最終執行 typecheck、tests、lint 與相關瀏覽器回歸。
- commit、push 已獲使用者追加授權；從本機 fix/mobile-data-safety 推回原 PR 的 ui/mobile-home-buttons；先整合該分支新提交，不 force push、不合併 main。

## 方案取捨

1. 通知採「逐筆確認」：比一次展示全部事件更適合小螢幕，且能明確知道確認了哪位船員。確認全部不作為預設。
2. 輸入採「空值草稿＋數字欄位＋輔助滑桿」：比單純擴大滑桿範圍更能兼顧精確值與快速操作，也可清空誤填項目。
3. 日期採「每列完整 UTC 日期＋時間」：不改現有七列分頁，避免日期分組額外改變分頁與版面。

上述方案已獲使用者批准；完成預覽後，使用者追加授權檢查通過即可 commit、push。

## 檔案與責任

| 檔案（相對工作樹） | 變更責任 |
| --- | --- |
| health-system/web/src/EmergencyNotices.tsx | 手機未讀集合、逐筆確認與 sessionStorage |
| health-system/web/src/Measure.tsx | 空值初始狀態、精確輸入、滑桿同步 |
| health-system/web/src/AssessmentForm.tsx | NEWS2 手動輸入及可清空行為 |
| health-system/web/src/mobile-home.css | 量測數字欄位及通知計數的手機版面 |
| health-system/web/src/news2.css | NEWS2 精確輸入版面 |
| health-system/web/src/HistoryTimeline.tsx | 每列 UTC 日期、時間 |
| health-system/web/src/history-timeline.css | 日期／時間兩行排版 |
| health-system/web/tests/browser/mobile-safety.spec.ts（新增） | 四項功能回歸與 API 資料驗證 |
| health-system/web/playwright.body.config.ts | 僅在測試隔離需要時支援環境指定埠／Python |
| health-system/web/tests/browser/server.py | 與設定檔共用可覆寫測試埠，仍使用暫存資料庫 |

優先修改以上既有檔案，不建立通用狀態管理層或新的 UI 套件。現有測試設定的 testDir 已能收錄新增 spec。根目錄 .gitignore 會忽略新 tests／spec 檔，交付前必須檢查新測試未被漏掉；本輪已加入只涵蓋 mobile-safety.spec.ts 的精確白名單；未暫存任何檔案。

## 任務 1：緊急事件逐筆確認

**現況：** EmergencyAlert 只渲染 unseen[0]，acknowledge 卻保存 items[0].createdAt，導致較早未展示的事件一起被清除。同時間戳不同 ID 也不能可靠區分。

**介面：** 保持 EmergencyAlert 現有 props 與 openAid(): void 不變；內部以 acknowledgedIds: Set<string> 取代 seenAt。確認動作接收畫面實際顯示的 event ID。

- 在新增瀏覽器測試中建立 A、B 兩個其他船員事件；確認 B 後，A 必須仍在未讀集合，鈴鐺由 2 變 1，最後確認 A 才消失。先在原版執行，確認此案例失敗。
- 使用新的、依 username 隔離的 sessionStorage key（例如 orbital.emergency.ackIds.v1.<username>）存 JSON ID 陣列。
- 不沿用舊 seenAt 自動確認事件，避免繼承原先遺漏；升級後現有 feed 的事件可能重新提示一次，這是本方案明確選擇的取捨。
- 保留「自己的 manual 不提示、自己的 sensor 仍提示」篩選，事件順序沿用 feed。
- 「我知道了」與「開啟急救指引」都只確認正在顯示的 ID。進入急救指引後其餘未讀保留鈴鐺，避免連續彈窗阻擋已選擇的指引；後續真正新到的事件仍可觸發提示。
- 保留既有 30 分鐘自動彈窗規則；較舊事件可透過鈴鐺查看。逐筆確認時保留已開啟狀態直到佇列清空或使用者開啟急救。
- sessionStorage JSON 損毀或無法寫入時，降級為本次記憶體狀態，不讓畫面崩潰；寫入成功與否不得擴大確認範圍。
- 補測相同 createdAt 不同 ID、重複 SSE、重新載入、帳號切換、舊 key、彈窗顯示時新事件到達。新事件不得因上一筆確認而被消失。

**驗收：** 未展示事件不會被確認；同一事件重新連線不重複計數；各帳號互不影響。

## 任務 2：量測預設空值，禁止提交未填的範例數值

**現況：** Measure 的 newDraft(metric, slider) 在手機直接放入 72、98、120/80、36.6；makeCommand 把它們當作已輸入資料。

**介面：** 維持 Draft.values: string[]、makeCommand 與 /manual-measurements 不變。newDraft 的所有欄位一律空字串；滑桿起點僅供視覺定位，不能寫入草稿。

- 建立手機測試：開啟量測後不操作數值，不得進入可保存的有效數值確認，也不得呼叫保存 API；切換各指標與「新增下一筆」同樣保持空值。
- 空值顯示「未輸入／Not entered」，可由數字欄位或滑桿操作明確填入；滑桿操作前不顯示起點為已測值。
- 刪除任何以預設數值初始化 Draft 的路徑；保留桌機的空值語意。
- 缺值選項仍清空數字並要求原因；由 missing 改回 good 不得恢復或產生預設值。
- 血壓兩欄分開維護，僅一欄填入時保留既有「另一欄缺值＋原因」流程，不自動補 80 或 120。
- 保存確認頁與伺服器回讀資料必須完全等於使用者輸入，且保留合成訓練資料、方法、品質、時間等來源資訊。

**驗收：** 沒有操作數值就不會產生假量測；合法缺值與部分血壓仍可保存。

## 任務 3：滑桿之外可輸入精確值及範圍外值

**現況：** Measure 與 News2 手機模式都只提供狹窄範圍的滑桿。後端 NEWS2 支援血氧 0–100、心率／收縮壓／呼吸頻率 >= 0，體溫為有限數值；一般人工量測契約並未採用相同的範圍限制。

**介面：** 每個數字維持單一草稿來源。沿用 type=number、step=any 的既有桌機規則；不能把一般人工量測與 NEWS2 的驗證混為一套。

- 在 Measure 與 NEWS2 手動填值區提供有明確標籤、單位的數字欄位，保留滑桿與加減按鈕作為輔助。
- 數字欄位可清空；NEWS2 清空後仍可保存部分評估，不以手動輸入按鈕自動填 98 等起始數值。
- 超出滑桿區間的有效草稿值維持原值，顯示「超出滑桿範圍，請用數字欄位調整」；此時停用滑桿／加減控制，避免一按就截斷到端點。
- 滑桿範圍仍是操作輔助，不作為驗證或醫療正常值判定。正常範圍與 NEWS2 分數不在本任務中新增或修改。
- NEWS2 維持現有非負限制、血氧上限 100 與有限數字規則；一般量測沿用現有契約，不擅自新增後端限制。
- 測試血氧 65、心率 220、收縮壓 230、體溫 33.5，以及 NEWS2 呼吸 45；API 保存及回讀必須維持原值。
- 測試小數 36.65、空白、零值、NEWS2 血氧 101／負心率拒絕、linked reading 切回手動、已存範圍外評估重新開啟。
- 確認 360／375／390／430px 與桌機可操作，數字鍵盤不永久遮住保存鈕；小螢幕可合理捲動，不能為「不用滑」裁掉欄位。

**驗收：** 手機能記錄桌機／後端允許的相同數字，不因 UI 將讀值截斷或四捨五入。

## 任務 4：跨日歷史明確標示每列日期

**現況：** HistoryTimeline 以 shown[0] 的日期作共用表頭，其他列只顯示時分秒。

**介面：** 保留 Row、rows(items)、PER_SCREEN=7 與游標 API；僅改每列呈現及相關 CSS。

- 建立同頁資料 2026-11-15T00:01:00Z 與 2026-11-14T23:59:00Z；兩列應分別顯示自己的日期，原版此案例應失敗。
- 將共用單日表頭改為中性的「量測時間（UTC）」；每列以兩行呈現 YYYY-MM-DD 與 HH:mm:ss。
- 日期／時間從同一 observedAt 以 UTC 格式化，不能混用本機日期與 UTC 時間；aria-label 仍提供完整時間。
- 測試跨月、跨年、相同時刻不同日期、換頁及 Asia/Taipei／America/Los_Angeles 瀏覽器時區，資料顯示保持 UTC。
- 詳細頁時間應與列上的時間一致；手機不橫向溢出，七列與翻頁按鈕可到達。

**驗收：** 不進入詳細頁，也能正確辨識每筆資料屬於哪一天。

## 整合與回歸

- 新增 mobile-safety.spec.ts 使用既有 server.py 的暫存資料庫，禁止對日常 demo／已開啟的 8000 服務寫測試資料。
- 優先採用既有 Playwright fixture 與登入方式。事件排序／時間邊界可用固定 API／SSE fixture；另保留至少一個真實兩帳號求助與一次保存回讀案例，驗證完整流程。
- 測試服務預設埠 8018 若被使用，透過同一環境參數在設定檔及 server.py 同步改為空閒埠，保留 reuseExistingServer=false；Python 可透過環境變數指定獨立 venv。
- 五項易漏邊界已納入上述任務：同時間戳事件、新事件到達競態、切換品質造成假值、範圍外值重載、跨時區跨年日期。
- 執行順序：任務 1 → 任務 2 → 任務 3 → 任務 4。任務 2、3 同改 Measure，連續完成可減少互相覆蓋。
- 命令工作目錄：health-system/web。
  - npm run typecheck
  - npm test
  - npm run lint
  - npm run build
  - npx playwright test --config=playwright.body.config.ts mobile-safety.spec.ts
  - npm run test:body（既有人體圖與新增手機案例的全套回歸）
- 先記錄未修改版本的基線。新測試在修正前應針對目標缺陷失敗，修正後通過；不能以跳過斷言換取通過。
- 檢查手機入口、急救、語言切換、桌機量測／NEWS2 與人體圖；保留關鍵畫面、測試報告與 request／response 斷言證據。
- 完成後提供 diff 摘要、測試數／結果及未測限制，再由使用者決定是否 commit、push 或更新 PR。

## 本輪實際狀態

四項產品修正與回歸測試已完成。下方保留實作階段的驗證快照；最新提交授權與審核基準見文件開頭及提交前複查紀錄。


### 基線驗證結果（2026-11-15）

- npm ci --ignore-scripts --no-audit --no-fund：完成，依鎖檔安裝 187 個套件。
- npm run typecheck：通過，退出碼 0。
- npm test：4 項通過，0 項失敗；目前都是 body-map 單元案例。
- npm run lint：通過，退出碼 0。
- 尚未執行 build／瀏覽器測試；新增的四項回歸案例尚未實作，不能用上述基線宣稱缺陷已修復。
- 工作樹：C:\Users\yf100\.codex\worktrees\pr4-mobile-review。
- 分支：fix/mobile-data-safety，追蹤 origin/ui/mobile-home-buttons，HEAD 為 26fc7306。
- Git 共用資料庫仍位於 C:\Users\yf100\AppData\Local\Temp\nasahackathon-pr4-review\.git；工作期間不可清除此來源目錄。長期保留時應先遷移來源儲存庫並以 git worktree repair 修復連結，再驗證。
- 原生工作樹建立工具未回應後，已核對沒有產生工作樹，才採 Git 命令建立；本次未改原專案工作區。


### 實作階段驗證快照（2026-11-15，整合前）

- 通知：依帳號儲存已確認 ID，每次只確認顯示中的事件；急救指引保留其他未讀，新事件仍可提示；損壞或不可寫的 sessionStorage 可降級。
- 量測與 NEWS2：預設空白、精確數字輸入、保留缺值及既有驗證；範圍外或超過滑桿步距精度時停用滑桿及加減，避免截斷或捨入。
- 歷史：每列顯示完整 UTC 日期與時間，保留七列分頁。
- 獨立 reviewer 發現精確小數按加減可能捨入的 P2 問題；先以 72.5 重現失敗，再修正並通過回歸。已確認的產品問題均已處理；reviewer 未另行執行最終測試，以下結果由主執行者實際驗證。
- `npm run typecheck`：退出碼 0。
- `npm test`：4 項通過，0 項失敗，退出碼 0。
- `npm run lint`：退出碼 0；兩個瀏覽器 spec 額外執行 ESLint 亦退出碼 0。
- `npm run build`：退出碼 0；保留既有大於 500 KB 的 chunk 提示。
- 新手機 spec 獨立 TypeScript 檢查通過；正式專案 typecheck 亦通過。
- `npm run test:body`：118 項通過、0 項失敗、32 項依版型跳過，退出碼 0。涵蓋 360／375／390／430px、橫向與桌機；跳過項目為手機或寬版專屬案例，不是跳過失敗。
- 真實保存與 API 回讀、兩帳號求助與 SSE、同時間戳 ID、帳號隔離、儲存失敗、精度與範圍邊界、UTC 跨日／跨月／跨年及時區分頁均有回歸案例。
- `git diff --check` 通過；HEAD 仍為 `26fc7306b5cd44f9772b35952b807bbb6e05e3c7`，index 無暫存變更。

**測試穩定性修正：** 人體圖案例隔離其他 suite 發出的通知；非同步顏色改用條件輪詢；離線案例先等待歷史載入完成再發 online。保留原功能斷言，未以固定等待或刪除斷言掩蓋問題。

**可追溯證據：** 工作樹 `.qa/pr4/acceptance.log` 為最終完整瀏覽器結果；`red.log`、`green.log`、`review-red.log`、`build-final.log` 與 `progress.md` 保留重現、修復及判斷紀錄。`.qa` 為本機忽略的測試產物，不在待提交檔案內。

**限制：** 手機驗證使用 Chromium 模擬 viewport；真實手機軟鍵盤遮擋、觸控與其他瀏覽器尚未實機驗證。測試使用埠 8028 與暫存資料庫；原專案 venv 僅提供 Python 解譯器，未寫入日常服務資料。未 commit、push、merge 或發布 GitHub review。


### 提交前複查與原 PR 整合（2026-11-15）

- 使用者確認推回原 PR #4 的 `ui/mobile-home-buttons`，交由 Claude 審核。本機工作分支仍為 `fix/mobile-data-safety`。
- 提交父版本更新至 `68ef634f85fe9e48e31a89e04a5d847574ca11d0`，保留來源分支 `4ab2be2`、`68ef634` 的英文預設、首頁生命徵象元件、公共顯示板與桌機歷史 12 列分頁。上述原始功能不屬於本次修正。
- CSS 衝突僅為兩邊在檔尾新增不同樣式；完整保留來源樣式與本次精確輸入樣式。
- 新測試語言設定改用來源分支採用的 sessionStorage。提交前第一次重跑出現兩個攔截請求清理錯誤；已在兩個 spec 的 afterEach 等待 unrouteAll(wait)，自建時區 context 亦先清理攔截再關閉，沒有忽略錯誤或刪除功能斷言。
- 自我審查核對逐筆確認、帳號重掛載隔離、空字串與零值、有限數值驗證、滑桿精度、UTC 格式及整合差異；未發現待處理的產品阻擋問題。
- 本機預覽資料庫、日誌與 build 產物不納入 commit。真機軟鍵盤與非 Chromium 瀏覽器限制仍適用。

- 整合版第一次全套為 117 通過／1 失敗／32 跳過；失敗為既有舊背景回應案例在初始歷史載入結束前觸發 online。Trace 顯示其捕獲的是十秒週期請求，因此等不到歷史回應。測試改為自行建立兩筆掃描並等歷史比較選項就緒，再觸發 online；原有 32.7 與恢復中斷言保留，針對 phone-430 重複三次均通過。

**最終提交前結果：** `npm run typecheck`、`npm test`（4/4）、`npm run lint`、兩個瀏覽器 spec ESLint、`npm run build` 與新 spec 獨立 TypeScript 檢查均通過。最終完整 `npm run test:body` 為 **118 通過、0 失敗、32 依版型跳過**，退出碼 0；證據在本機 `.qa/pr4/push-acceptance.log`。`git diff --check` 與暫存差異檢查均通過。待提交變更只包含本方案的程式、測試與文件；使用者已授權 commit 並以非強制推送更新原 PR 分支。
