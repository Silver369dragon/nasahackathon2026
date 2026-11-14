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

The comparison window covers the preceding seven days under matching conditions. With at least 30 valid samples and sufficient variance, the app shows a Z-score and an exponentially weighted moving average with weight 0.2. The simulator contributes at most one valid sample per second. This calculation is versioned as `training-window-v1`.

The default Windows database is `%LOCALAPPDATA%\NasaHealthSystem\training.sqlite3`. To change it, set `HEALTH_DB_PATH` to a full local path outside a synced folder. Everyday use works with `runId=null`. Manual writes use the signed-in session and a CSRF token. Sensor writes use per-device bearer credentials. [API reference](http://127.0.0.1:8000/docs) · [Service readiness](http://127.0.0.1:8000/v1/health/ready)

### NEWS2 observations

1. Open the assessment as Mira and set the UTC observation time. Enter the four core vital signs directly or select existing heart rate, oxygen saturation, systolic pressure and temperature records.
2. Add respiratory rate and counting duration, consciousness level (ACVPU), room air or supplemental oxygen, and the designated oxygen saturation scale. Scale 2 requires confirmation of a clinical designation. For directly entered temperature, record its site and method. You can save a partial observation. [Royal College of Physicians NEWS2 resource](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/)
3. Ask the assistant what is missing from this assessment. It links its answer to the version you asked about. Later edits create a new version.
4. Open the monitoring station to see the latest completeness, gaps, observation time and valid readings per crew member. The detailed assessment is restricted to its owner and monitoring role.

The demo accepts existing measurements within five minutes on either side of the observation. Poor-quality, missing and out-of-window values do not count toward completeness. Once all eight items are present, the app marks the observation complete. The score stays blank pending approval of the ship’s scoring configuration.
