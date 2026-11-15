# Crew health system

**English** | [繁體中文](README.zh-TW.md)

Five fictional crew members use this local training app to log vital signs, complete daily tasks, review their own health records and request help. The monitoring station shows crew-wide updates. The read-only board can run on a separate screen or on the wall inside the [3D habitat](../astro-hiyoko-demo/README.md).

## Start on Windows

Use Python 3.12, Node.js 24 and npm. Open PowerShell in the `health-system` directory. On the first run, install the dependencies and build the web app, then start the server.

```powershell
.\setup.cmd
.\start.cmd
```

On subsequent runs, use `.\start.cmd`. FastAPI serves the web app, API and live updates on the same port. The default address is `127.0.0.1:8000`. Stop the server with `Ctrl+C`.

| Page | Account | Available actions |
| --- | --- | --- |
| [Crew app](http://127.0.0.1:8000/app) | `mira`, `kai`, `lin`, `noa`, `sol` | Log measurements, request help and receive crew alerts. |
| [Daily training](http://127.0.0.1:8000/app/tasks) | Crew | Time an exercise, log minutes, complete a self-assessment and review progress. |
| [Personal trends](http://127.0.0.1:8000/app/trends) | Crew | Explore four vital signs by time, source and method, down to the original readings. |
| [NEWS2 assessment](http://127.0.0.1:8000/app/news2) | Crew | Assemble an observation, link measurements and review missing fields. |
| [Health assistant](http://127.0.0.1:8000/app/assistant) | Crew | Ask questions in English or Traditional Chinese and open the records cited in an answer. |
| [First aid](http://127.0.0.1:8000/app/first-aid) | Crew | Read bilingual training cards or notify the crew. |
| [Monitoring station](http://127.0.0.1:8000/system) | `monitor` | Review crew readings, history and alerts. |
| [Read-only board](http://127.0.0.1:8000/board) | `display` | Show the latest readings and alerts on a shared screen. |

The default training password is `orbital-demo`. Set `HEALTH_DEMO_PASSWORD` before starting the server to change it. To show several roles at once in the standalone medical app, use separate browser profiles so each retains its own session.

## Record a first measurement

1. Sign in to the crew app as `mira` and open the monitoring station as `monitor` in a separate browser profile.
2. On Mira’s phone or crew page, choose **Record measurement → Blood pressure**. Enter a sample systolic pressure of `118` and diastolic pressure of `76`. Check the posture and time, preview the entry and save.
3. Find Mira’s row at the monitoring station and open her history. The two values share a `measurementGroupId` and each has its own record ID.
4. To add synthetic sensor readings, run the adapter in a second PowerShell window from this directory. The adapter leaves Mira’s blood pressure available for manual entry.

```powershell
.\.venv\Scripts\python.exe mock_adapter.py --once
```

Omit `--once` to keep the adapter running. The backend and adapter share a locally generated device key. If you set `HEALTH_DB_PATH` or `HEALTH_MOCK_SECRET`, use the same value in both windows.

Cards prefer sensor data for heart rate and oxygen saturation, and manual entries for blood pressure and temperature. They fall back to the other source when the preferred source has no data. History shows all sources.

## Demonstrate an alert

Open the crew app as Mira and Kai in separate browser profiles. On Mira’s overview, select **Request help**. Kai’s screen and the monitoring station show Mira’s name, the source of the alert and the same event time. Reconnecting retrieves up to 50 recent notifications.

To demonstrate an automatic alert, keep a receiving screen open and run these commands in order. The first sends synthetic high heart rates for Mira. The second sends recovery readings.

```powershell
.\.venv\Scripts\python.exe mock_adapter.py --scenario high --ticks 4
.\.venv\Scripts\python.exe mock_adapter.py --scenario recovery --ticks 4
```

The training rule `TRAINING_HR_RECHECK` raises one alert after three consecutive one-second buckets with valid synthetic resting heart rates above 110 bpm. Three consecutive valid buckets at or below that threshold allow a later episode to trigger a new alert.

### Phones and background notifications

For a phone on the same trusted Wi-Fi network, set `HEALTH_DEMO_PASSWORD` and set `HEALTH_BIND_HOST` to the computer’s Wi-Fi IPv4 address before starting the server. Open the crew URL printed in PowerShell. The phone can receive foreground alerts over local HTTP. Use `HEALTH_PORT` to change the port and allow that port on the private network if needed.

Background notifications use Web Push. Serve the app over device-trusted HTTPS with a same-origin reverse proxy or set `HEALTH_TLS_CERT` and `HEALTH_TLS_KEY`. On iOS or iPadOS 16.4 or later, add the app to the Home Screen first. Open the app, sign in and enable device notifications in the footer. Delivery requires access to the browser’s push service and depends on the device OS. Signing out or session expiry stops delivery for that subscription. The server generates its VAPID signing key locally and accepts a contact URI in `HEALTH_PUSH_CONTACT`. [WebKit’s Home Screen Web Push guide](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## Daily training and the health assistant

Each UTC day has an exercise, a manual measurement and a post-training self-assessment. Crew members can start a timer, enter minutes later, switch activities or record a reason for skipping. Badges mark the first, third and seventh exercise days. The default reminder is at 18:00 UTC and can be snoozed for 15 minutes. The station and board show team task counts. Self-assessments, reasons for skipping and chat citations are private to each crew member.

Try “Which training tasks did I finish today?” or “How does my resting heart rate compare with yesterday?” Expand a citation to inspect its time, value and source. First-aid cards on microgravity CPR and external bleeding on Earth are available locally in both languages.

The optional cloud assistant reads `OPENAI_API_KEY` from the server environment or a local `.env.local` file. The default model is `gpt-4.1-mini`, configurable with `HEALTH_AI_MODEL`. Conversation history stays on the local server. A cloud request includes the question and relevant synthetic evidence. To rehearse offline operation, set `HEALTH_AI_OFFLINE=1` before startup. Local summaries, first-aid cards and crew alerts remain available.

## Trends, storage and API

Choose a one-hour, 24-hour, seven-day, 30-day or custom UTC interval on the trends page. Each series groups readings by source, method, context and data type. Missing or poor-quality readings break the line. Select a point to inspect the original record. Dense charts keep the first, last, highest and lowest value in each display bucket while the statistics use all valid samples.

Heart rate, SpO₂, respiratory rate, systolic pressure, diastolic pressure and temperature support fixed baselines. Review the preceding seven days before choosing **Create fixed baseline**. At least 30 valid samples and sample SD greater than `1e-9` are required. Each crew/metric/source/method/unit/context series has one current version; every version permanently preserves its sample IDs, dates and parameters. Queries never replace a baseline.

Creation analyzes existing matching readings at or after the cutoff. Later manual, live and imported readings save their analysis in the measurement transaction. `fixed-baseline-v2` records the measurement, baseline version, algorithm, segment, Z-score and EWMA (weight 0.2); existing v1 records remain unchanged. Unusable quality, a cadence change or a gap exceeding four times `context.analysisCadenceSeconds` starts a new segment. Cadence is metadata, not a comparison key; rest and exercise remain separate. Mock series use the first valid representative per UTC second. Late and duplicate-second inputs retain explicit statuses without changing earlier EWMA results.

**Baseline versions and review** provides candidates, explicit approval, exclusions, rebuild, freeze/resume, unwell markers and retirement with reasons and audit history. Exclusions invalidate pending candidates, including before first activation. Frozen parameters still calculate; replacement requires explicit resume. Related existing HR alerts freeze the matching series and prevent resume/activation while active; clearing does not auto-resume. Real measurements require a separately approved profile.

**Ask about this analysis** carries the immutable `analysisId`. **Save recalculated revision** creates a new ID and `analysisRevision` for one selected observation with a separate EWMA segment, preserving historical and streaming state. Charts use their saved analysis's baseline and show the current version separately. NEWS2, six statistics, body and radiation remain separate, with no aggregate health score or clinical assessment.

Private crew APIs: `POST /v1/baselines` (`commandId`, owned `measurementId`, `referenceTo`; CSRF required), `GET /v1/baselines/{id}`, `GET /v1/analyses/{id}` and `/v1/assistant/records/analysis/{id}`. Assistant queries accept `analysisId`. Additive tables use the existing SQLite database; upgrading does not automatically activate a baseline.

Version APIs: `GET /v1/baselines?measurementId=...`, `POST /v1/baselines/candidates/new`, `POST /v1/baselines/{id}/actions`, and `POST /v1/analyses/{id}/recalculate`. Commands require CSRF, `commandId`, `expectedRevision` and a reason. Candidates specify owned measurement ID and cutoff. Restart initializes additive tables without rewriting saved baseline/analysis JSON.

### Saved three-layer reports

The phone NEWS2 form also offers **Save three-layer report** after saving the observation. In the visual trends view, choose **Baseline & detailed analysis** to review candidates, manage versions and open saved analysis citations; **Back to trend summary** returns to the compact chart.

On NEWS2, **Save three-layer report** pins the exact assessment version, linked measurements and saved analyses/baselines, existing rule/alert evidence, quality/time/source limits and knowledge/procedure versions. Manual values never borrow unrelated statistics. Diastolic pressure is explicitly outside NEWS2's linked inputs. Without NEWS2, latest measurements remain separate with comparison limits.

**Ask about this report** passes the same `reportId`; related follow-ups retain the snapshot while new task/measurement questions can switch topics. The model cannot override scores, required facts or citations. Offline, timed-out or rejected output falls back to local facts, with template/model/verification metadata. `POST /v1/health-reports` accepts `commandId` and optional assessment ID/version; GET lists summaries for owners/monitors, while full reports and assistant sources are owner-only and unavailable to public boards. Replays do not duplicate reports; GET never recalculates and later changes cannot rewrite snapshots.

The default Windows database is `%LOCALAPPDATA%\NasaHealthSystem\training.sqlite3`. To change it, set `HEALTH_DB_PATH` to a full local path outside a synced folder. Everyday use works with `runId=null`. Manual writes use the signed-in session and a CSRF token. Sensor writes use per-device bearer credentials. [API reference](http://127.0.0.1:8000/docs) · [Service readiness](http://127.0.0.1:8000/v1/health/ready)

### NEWS2 observations

1. Open the assessment as Mira and set the UTC observation time. Enter respiratory rate, heart rate, oxygen saturation, systolic pressure and temperature, or link original measurements. Linked respiratory rate uses its original `context.observationDuration`; manual duration cannot fill a linked record's missing context.
2. Record counting duration for manually entered respiratory rate, consciousness (ACVPU), air or supplemental oxygen, and the prescribed saturation scale. Scale 2 requires explicit selection and a documented clinical designation; it is never inferred from readings. Direct temperature entry needs site and method. Partial observations can be saved. [RCP NEWS2 scoring chart](https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf)
3. Review the saved training total and seven component scores (six physiological parameters plus oxygen). The eight-input completeness count includes scale selection. Missing, poor-quality or out-of-window inputs leave the full total unavailable; valid components remain visible. A dash is not zero.
4. Select **Ask about this NEWS2 assessment**. The assistant cites the saved scores, scoring version and gaps. Later edits create a new record version and preserve earlier citations. The monitor receives the latest summary; full records are owner-only, unavailable to other crew and the public board.

The five-minute linking window is a training engineering setting. `HEALTH_NEWS2_PROFILE` defaults to `rcp-news2-2017-training-v1`; set it to `disabled` before startup to disable scoring of new records. Unknown versions also disable scoring, without falling back. Restart the service after changing configuration. The form displays the current setting from `/v1/news2/config/current`.

Each saved version stores `componentScores`, `news2Score`, `scoringInputs`, `ruleSetVersion`, `normalizationVersion` and configuration status. Configuration changes, restarts and request replays never recalculate existing versions. Legacy completeness records remain unchanged; save a new version to calculate a score.

The application's `decimal-half-up-v1` training input policy rounds respiratory rate, saturation, systolic pressure and pulse to whole numbers, and temperature to 0.1°C. For example, 18.5 breaths/min scores as 19. Both original and scoring values are retained and visible. This is an application engineering policy, not an RCP decimal-measurement rule. Results are for synthetic training only, with no clinical grading, diagnosis, treatment or automatic escalation.

Scoring source: Royal College of Physicians. *National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS*. Updated report of a working party. London: RCP, 2017. The Chinese wording has not been specifically approved by the RCP; refer to the English original. [Additional Scale 2 guidance](https://www.rcp.ac.uk/media/umzn4ntq/news2_additional-guidance-002-_0.pdf)

New NEWS2 records also save single-3 parameters, `riskBand`, `interpretationVersion` and the [RCP Chart 2](https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf) source. Missing totals have no aggregate band. Legacy chart comparisons are labelled as not saved in the original record. This training display creates no new broadcasts or clinical response instructions.

## Body hologram demo

The revised renderer is labelled `HOLOGRAPHIC / 02`: a transparent emissive body, contour lines, surface points, bloom, a 3D projection base and scanning beam. The projection control pauses/resumes its slow animation; reduced-motion preferences start it paused. Body orientation remains gesture-controlled. After source changes, build the frontend and reload the page; an already-open page retains its loaded JavaScript until reloaded.

Start with `start.cmd`, sign in as `mira`, and open **My body** on the overview or `/app/body-map`. Save a **Resting baseline** scan, then **After training**. Rotate the 22-region body, pinch to zoom, switch front/back, and select the anatomical left thigh to see its muscle/fat mass and injury. Switch to **Fat**, save **Recovery**, then open **History** and **Comparison & scan details**. Older scans show the injury state and composition from that same saved snapshot. **Partial scan** demonstrates unavailable left-forearm and back readings.

All body scans are synthetic and labelled as simulated. Whole-body fat percentage uses fat/body mass; regions display kg only. Scans persist in SQLite, belong to the signed-in crew member, and work with `runId=null`. Retrying an unconfirmed request reuses its identifier and does not duplicate the scan. Connection failures retain data already loaded on the page; initial offline loading requires reconnection.

The local launcher enables `HEALTH_BODY_SCAN_DEMO=1` unless overridden. Set it to `0` to disable new demo scans; direct uvicorn startup requires explicitly enabling it. Saved scans remain readable. Session-protected endpoints are `/v1/body-scans/latest`, `/v1/body-scans` (cursor pagination), `/v1/body-scans/{id}`, and `POST /v1/body-scans/demo` (also requires CSRF). These scans do not alter telemetry or NEWS2.

The original 22-region GLB is about 1.94 MB / 26,764 triangles; see `web/public/body/LICENSE.md` for provenance and CC0 terms. Regenerate it with `node tools/create-body-model.mjs` and its static card image with `node tools/create-body-preview.mjs` from `web`. Three.js loads only on the body page. A WebGL/model failure falls back to a selectable 2D body while retaining the data and comparisons.

Run the usual frontend typecheck, tests, lint and build, then `npm.cmd run test:body` for the isolated body-browser suite. Body tests cover 360/390/430px, landscape and desktop Chrome with simulated touch; physical-phone Safari behavior and sustained rotation performance still need device verification.

## Space radiation monitoring

The first authenticated view starts one persisted mission. Fictional prior exposure is Lin 216, Kai 162, Mira 72, Noa 18 and Sol 288 mSv, backed by nine historical mission records. A single backend clock adds the same exposure to all five people at 75 μSv/h (one real second per monitoring second). Reloading, switching people or closing every browser does not reset the mission; the running backend continues accumulating.

Personal views separate prior exposure, shared increment and comparable total. The monitor sees all five; the public board has no personal histories. Monitor-only simulation controls select elevated (150 μSv/h) or SPE (750 μSv/h), then restore background without reducing dose. These are Simulation values, not safety thresholds; vital signs and NEWS2 remain independent.

Storage uses the existing `HEALTH_DB_PATH`. Upgrading an old database first creates a SQLite backup named `*.before-radiation.sqlite3` beside it. Shutdown checkpoints the clock; a crash restores the last committed checkpoint without extrapolating downtime. Use a separate DB for testing.

The additive `radiation/1` contract uses existing sessions/CSRF and Snapshot/SSE (`radiation.updated`). Resources: `GET /v1/radiation/current?view=...`, `/environment?missionId=...`, `/crew/{crewId}`, `/crew/{crewId}/history`, monitor-only `POST /demo-event` and `/samples` under `/v1/radiation`. Existing telemetry 1.2/1.3 is unchanged. See the [Chinese API notes](README.zh-TW.md#太空輻射監測) for fields.

Defaults: `HEALTH_RADIATION_ENABLED=1`, `HEALTH_RADIATION_SOURCE=simulation`. For a new external simulation mission set `HEALTH_RADIATION_SOURCE=json` and `HEALTH_RADIATION_SOURCE_ID` (default `demo`) before first activation. Existing missions retain their source. External cumulative values exclude personal history and become authoritative, with no extra rate integration. Missing/stale/conflicting input never becomes zero or a fabricated live reading.


## Import demonstration history

### 30-day history and five-minute playback

The [v3 archive](../output/health-demo-v3/crew-demo-v3.zip) follows the [synthetic data contract](DATA_DEMO_FORMAT.zh-TW.md): five fictional profiles, 216,000 historical packets, 900 historical NEWS2 observations, 25 body scans and 1,505 playback packets over 300 seconds. From the repository root, prepare a new candidate database:

```powershell
.\health-system\.venv\Scripts\python.exe .\health-system\demo_prepare.py --dataset .\output\health-demo-v3\crew-demo-v3.zip --output "$env:LOCALAPPDATA\NasaHealthSystem\crew-demo-v3-candidate.sqlite3"
```

`--dataset` and `--output` are required. Preparation validates the ZIP before writing, refuses an existing target or `.building` file, and creates 30 resting baselines from `[preparedAt − 14 days, preparedAt − 7 days)`. It does not replace the running service's database. Use a new candidate path for another preparation; keep existing records and sessions intact.

When the medical service uses a prepared database, open the cabin's `/playback.html`, sign in as `monitor`, and select **開始新的示範** / **停止示範**. Each start creates one backend-owned 300-second run; completion retains its saved results. Refreshing or closing the control tab does not restart or stop it. Connected mode has no automatic loop, pause or speed control. Stop other senders; competing mock ingestion is rejected while playback runs.

History ends at `preparedAt − 60 seconds`; playback begins at its actual `startedAt`. Preparation time and start time are separate anchors: the real gap between them is not filled or retimestamped. Summary cards distinguish saved history, the current run and stale/unavailable data. The five-minute script adds no body changes; radiation adds its own dose, independently of NEWS2.

`GET /v1/demo/playback` requires an authenticated session. `GET /v1/demo/profile?crewId=...` and `/v1/demo/assessment?crewId=...` require the owner or `monitor`; the latter returns profile, playback, six baselines, saved NEWS2, body and radiation summaries. `POST /v1/demo/playback/start` and `/stop` require `monitor`, CSRF and `{commandId}`. These APIs do not expose personal profiles to the public board. Expected answers in the archive are test-only, never runtime inputs; synthetic examples do not prove clinical accuracy, real-device delivery or completed deployment acceptance.

### Separate historical JSON importer and legacy CLI

Sign in to `/system` as `monitor` / `orbital-demo`, select [crew-dataset.example.json](examples/crew-dataset.example.json) in the dataset importer, review the summary and import it. The `crew-dataset/1` JSON format supports measurements, body scans and radiation archives, up to 32 MiB. Repeating the same dataset ID and content does not duplicate records; different content requires a new ID. Observations must be historical, not in the future. Import writes to the active database; set a separate `HEALTH_DB_PATH` for an isolated demonstration.

The [legacy 60-second ZIP](../astro-hiyoko-demo/data/crew-health-sample60.zip) remains usable by `dataset_player.py --dataset ... --inspect` (or the separate CLI sender). It contains 300 packets and 1,215 metrics per cycle. The current cabin `/playback.html` does not read it. Legacy ZIP, v3 `crew-demo/1` archive and `crew-dataset/1` historical JSON are distinct formats; do not interchange them.
