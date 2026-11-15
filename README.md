# Astro Hiyoko — Astronaut Health Monitoring Software

**English** | [繁體中文](README.zh-TW.md)

Astro Hiyoko is shipboard health monitoring software designed for space missions. It helps astronauts collect health indicators, understand changes in their own health and take follow-up action through reminders, health information and crew coordination. The project responds to the NASA Space Apps challenge [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/).

Our proposed three-layer analysis architecture combines **rule-based assessment, personalized statistical analysis and AI explanations grounded in evidence**. Crew members manage their records in a personal app, monitoring staff review the whole crew at a monitoring station, and a shared board displays the latest readings and alerts.

The current prototype runs locally, stores measurements in SQLite and provides five fictional crew accounts for training with manual entries and synthetic sensor data.

## Contents and guides

- [What the health system does](#what-the-health-system-does)
- [Three-layer health analysis architecture](#three-layer-health-analysis-architecture)
- [Start the health system on Windows](#start-the-health-system-on-windows)
- [Optional demo in the 3D habitat](#optional-demo-in-the-3d-habitat)
- [Added features and demonstration datasets](#added-features-and-demonstration-datasets)
- [Hardware simulation](#hardware-simulation)
- [Monitoring indicators and simulation values](numerical.md)
- [Telemetry firmware and backend integration (PR #6)](https://github.com/Silver369dragon/nasahackathon2026/blob/7340fcb3208ab0cfaeb68be30744b7537852fff3/firmware/README.md)

## What the health system does

| Feature | What crew members and monitoring staff can do |
| --- | --- |
| Vital-sign monitoring | Record heart rate, oxygen saturation, blood pressure and temperature. Review each reading's time, source, measurement method and data quality. |
| Personal health trends | Explore changes over different periods, compare readings by source and method, and open the original measurements. |
| Personalized statistical analysis | Compare readings with personal history. Use Z-scores and an exponentially weighted moving average (EWMA) to examine deviations and sustained changes. |
| NEWS2 observation records | Assemble physiological measurements, consciousness and oxygen information for one observation. Save partial entries and identify missing or unusable inputs. |
| Daily health management | Log exercise time, complete measurements and post-exercise self-assessments, receive reminders, and review personal badges and team completion counts. |
| Health assistant | Ask about personal records, training and alerts in English or Traditional Chinese. Follow up on an answer and open the original evidence it cites. |
| Help requests and automatic alerts | Notify crewmates and the monitoring station with one tap. Use a designated synthetic heart-rate scenario to demonstrate automatic alerts. |
| First-aid knowledge and procedure cards | Read local bilingual training materials and open relevant guidance from a health question or help-request scenario. |
| Crew monitoring and shared display | Review crew measurement history and notifications at the station. Show the latest readings and alerts on a read-only shared screen. |
| Local operation and storage | Save records locally and synchronize screens through live updates. Local summaries, training materials and crew alerts remain available when the cloud model is unavailable. |

The full data catalog defines **33 monitoring items** across emergency monitoring (12), daily health (9) and long-term monitoring (12). The current main measurement workflow supports heart rate, oxygen saturation, blood pressure and temperature. The remaining catalog entries guide further expansion.

See the [monitoring indicators and simulation baseline worksheet](numerical.md) for the team's physiological test ranges, radiation simulation values, reasons for selecting the indicators and references.

## Three-layer health analysis architecture

| Layer | Purpose | Processing and output |
| --- | --- | --- |
| **Layer 1 — Rule-based assessment** | Check whether readings meet specified conditions and whether an assessment has sufficient data. | Check data quality, timing and context before applying versioned rules. The design includes a NEWS2 component and total-score interface, alert reasons, triggering evidence and associated procedures. |
| **Layer 2 — Personalized statistical analysis** | Understand how a reading differs from that crew member's usual state. | Establish a reference from historical readings with matching sources, methods and contexts. Calculate Z-scores to express deviations and use EWMA to examine sustained changes. |
| **Layer 3 — LLM + RAG explanations** | Turn measurements, assessment results and retrieved knowledge into explanations crew members can understand. | Retrieve authorized personal records and local documents. Explain observations, reasons and missing data, provide relevant action links, and attach traceable sources. |

Layer 1 uses explicit rules to identify conditions that need attention. The NEWS2 design draws on six physiological parameters and supplemental oxygen information. The system first checks input completeness, then uses an enabled scoring configuration for calculation. [Royal College of Physicians NEWS2 reference](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/)

Layer 2 accounts for individual differences. The same heart rate can represent different deviations for two crew members. A Z-score expresses the difference from a personal mean in standard deviations. EWMA smooths successive deviations to help reveal whether a change persists.

Layer 3 uses a large language model (LLM) with retrieval-augmented generation (RAG) to explain the evidence. A crew member can ask which record supports an explanation or what is missing from an assessment, then open the referenced record or procedure card.

The diagram shows the proposed flow between the three layers.

```mermaid
flowchart TD
    A["Health measurements and personal records"] --> B["Data quality, timing and context checks"]
    B --> C["Layer 1: Rules and scoring"]
    B --> D["Layer 2: Personal reference and statistics"]
    C --> E["Layer 3: LLM + RAG explanations"]
    D --> E
    K["Local knowledge and procedure cards"] --> E
    C --> F["Alerts and crew notifications"]
    E --> G["Source-linked explanations and action links"]
```

### Current implementation

- **Layer 1** includes synthetic heart-rate alerts, NEWS2 completeness and quality checks, seven component scores and a complete total under a versioned training profile. Respiratory measurements link their original observation duration. Saved versions retain their scores and input-normalization policy; missing or unusable inputs leave the full total unavailable.
- **Layer 2** supports immutable baselines for heart rate, SpO₂, respiratory rate, systolic pressure, diastolic pressure and temperature. Candidates can be reviewed and activated, frozen, resumed, rebuilt or retired, with exclusion periods and an audit history. Version-linked Z-scores and EWMA are saved per measurement; explicit recalculation creates a new revision without rewriting historical evidence. The v3 demo prepares six resting baselines per crew member (30 total) from `[preparedAt − 14 days, preparedAt − 7 days)`.
- **Layer 3** provides authorized personal-record queries, local knowledge retrieval, citations and model-answer verification. Saved three-layer reports pin the NEWS2 version, matching measurements and baseline analyses, rule evidence and knowledge versions. The assistant can explain the same report and preserve it across follow-up questions; unavailable or rejected model output falls back to local evidence. These sources remain separate, with no aggregate health score; synthetic training results do not establish clinical accuracy or operational readiness.

## Start the health system on Windows

Install Python 3.12 and Node.js 24 with npm. From the repository root, run these commands in PowerShell.

```powershell
.\health-system\setup.cmd
.\health-system\start.cmd
```

The first command installs dependencies and builds the web app. On subsequent runs, only the second command is needed. Keep that window open while using the system. The default training password for all accounts is `orbital-demo`.

| Local page | Sign in as | What you see |
| --- | --- | --- |
| [Crew app](http://127.0.0.1:8000/app) | `mira`, `kai`, `lin`, `noa` or `sol` | Your measurements, trends, daily training and help button |
| [Monitoring station](http://127.0.0.1:8000/system) | `monitor` | All five crew members, their measurement history and incoming alerts |
| [Read-only board](http://127.0.0.1:8000/board) | `display` | Latest crew readings and alerts for a shared screen |

### Try a first measurement

1. Open the crew app as `mira`. In a separate browser profile, open the monitoring station as `monitor` so both sessions stay signed in.
2. In Mira’s app, select **Record measurement → Blood pressure**. Enter a sample such as `118/76 mmHg`, check the time and posture, then preview and save.
3. Watch Mira’s row update at the monitoring station. Open her history to inspect the saved measurement. To try an alert, select **Request help** on Mira’s overview and watch the station show her name and the event time.

For sensor simulation, offline operation and detailed feature instructions, see the [health system guide](health-system/README.md).

## Optional demo in the 3D habitat

The 3D website shows how the medical software could be used inside a spacecraft. The five crew phones open their owners’ health apps, and the commons wall displays the shared health board.

Leave the medical service running. In a second PowerShell window, start at the repository root and run the following commands. Use a browser with WebGL 2 support.

```powershell
cd .\astro-hiyoko-demo
npm.cmd ci      # First run only
npm.cmd start
```

Open the [connected cabin](http://127.0.0.1:4173/) in two browser windows. In the first, use **Go to area** to enter the commons and wait for **Live** on the wall. In the second, select **Mira** under **Crew devices** and tap **Request help**. The wall shows **Mira · Manual help request** and the event time.

With only the 3D service running, you can also explore four scripted scenarios. Press **F** to choose one. Stop each running service with `Ctrl+C` in its PowerShell window. [Standalone simulation](http://127.0.0.1:4173/?mode=simulation) · [3D demo guide](astro-hiyoko-demo/README.md)


## Added features and demonstration datasets

- **Space radiation monitoring:** personal views show prior exposure, shared increment and total; monitoring staff can view all five crew and control simulated events. The cabin's **More → Open radiation monitor** reads the same persisted backend mission. Reloading does not reset exposure. All radiation values are Simulation.
- **Historical dataset import:** sign in as `monitor`, open `/system`, choose a JSON file, review its summary and import it. Measurements, body scans and radiation archives are supported. Imported radiation archives are displayed separately from the live mission.
- **30-day history + 300-second playback:** prepare a separate candidate database using `demo_prepare.py --dataset ... --output ...` as described in the [medical guide](health-system/README.md#30-day-history-and-five-minute-playback). After the medical service uses a prepared database, a `monitor` manually starts or stops one run from `http://127.0.0.1:4173/playback.html`. The backend owns the clock and saves progress; refresh does not restart it. Connected mode has no loop, pause or speed control. History is anchored to `preparedAt`, playback to `startedAt`; any real gap between them remains visible.

| File | Purpose |
| --- | --- |
| [v3 demonstration ZIP](output/health-demo-v3/crew-demo-v3.zip) | Five fictional crew, 30 days of history, six baseline metrics and one 300-second script. See the [data contract](health-system/DATA_DEMO_FORMAT.zh-TW.md). Preparation validates hashes and builds a new candidate database. |
| [Legacy 60-second dataset](astro-hiyoko-demo/data/crew-health-sample60.zip) | Retained for the separate `health-system/dataset_player.py` CLI. The current `/playback.html` does not load this ZIP. |
| [Historical JSON example](health-system/examples/crew-dataset.example.json) | Select this file in the monitoring station's dataset importer to demonstrate the `crew-dataset/1` historical format. |

`health-system/backend/radiation*.py` implements accumulation, persistence and APIs; `dataset_import.py` and `body_import.py` handle imports. `RadiationPanel.tsx` and `DatasetImport.tsx` provide the medical UI; `astro-hiyoko-demo/radiation-monitor.js` connects the cabin display. See the [health-system guide](health-system/README.md) and [cabin guide](astro-hiyoko-demo/README.md).

Playback status requires an authenticated session. Personal profiles and assessment summaries require the crew owner or `monitor`; start/stop requires `monitor` plus CSRF. Synthetic data and expected answers demonstrate software behavior, not medical performance; expected answers are test-only and are not runtime inputs.

## Hardware simulation

- **Wokwi circuit simulation:** Interactive simulation of the ESP32-based biomedical sensing system, including sensor connections and firmware.

  [Wokwi Simulation](https://wokwi.com/projects/480433596780917761)

- **Telemetry firmware and backend integration:** The [firmware guide (PR #6 version)](https://github.com/Silver369dragon/nasahackathon2026/blob/7340fcb3208ab0cfaeb68be30744b7537852fff3/firmware/README.md) explains how the ESP32 gateway sends synthetic data for five crew members to the medical backend, including the packet format, Wokwi setup, verification results and current limitations.
