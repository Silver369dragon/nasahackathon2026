# Astro Hiyoko — Astronaut Health Monitoring Software

**English** | [繁體中文](README.zh-TW.md)

Astro Hiyoko is shipboard health monitoring software designed for space missions. It helps astronauts collect health indicators, understand changes in their own health and take follow-up action through reminders, health information and crew coordination. The project responds to the NASA Space Apps challenge [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/).

**We implement component scores, the complete total score and risk classification according to RCP NEWS2 (2017), and combine them with personal-baseline analysis and evidence-grounded AI explanations; data-quality checks, visual indicators and onboard alerts are custom features of our system.** Crew members manage their records in a personal app, monitoring staff review the whole crew at a monitoring station, and a shared board displays the latest readings and alerts.

The current prototype runs locally, stores measurements in SQLite and provides five fictional crew accounts for training with manual entries and synthetic sensor data.

**Version scope:** The three-layer assessment progress below corresponds to [health-assessment implementation 3eb8fa0](https://github.com/Silver369dragon/nasahackathon2026/commit/3eb8fa0558a66fac65c7019933bec7183396c9ef). That code is on `feat/ai-rag` and is not yet included in this hardware branch; to use these features, follow the [health-system guide for that version](https://github.com/Silver369dragon/nasahackathon2026/blob/3eb8fa0558a66fac65c7019933bec7183396c9ef/health-system/README.md).

## Contents and guides

- [What the health system does](#what-the-health-system-does)
- [Three-layer health analysis architecture](#three-layer-health-analysis-architecture)
- [Start the health system on Windows](#start-the-health-system-on-windows)
- [Optional demo in the 3D habitat](#optional-demo-in-the-3d-habitat)
- [Added features and demonstration datasets](#added-features-and-demonstration-datasets)
- [Hardware simulation](#hardware-simulation)
- [Monitoring indicators and simulation values](numerical.md)
- [Telemetry firmware and backend integration](firmware/README.md)

## What the health system does

| Feature | What crew members and monitoring staff can do |
| --- | --- |
| Vital-sign monitoring | Record heart rate, oxygen saturation, blood pressure and temperature. Review each reading's time, source, measurement method and data quality. |
| Personal health trends | Explore changes over different periods, compare readings by source and method, and open the original measurements. |
| Personalized statistical analysis | Compare readings with personal history. Use Z-scores and an exponentially weighted moving average (EWMA) to examine deviations and sustained changes. |
| NEWS2 observations and assessment | Assemble physiological measurements, consciousness and oxygen information for one observation. Save component scores, the complete total score and risk classification; identify missing or unusable inputs in partial entries. |
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
| **Layer 1 — Rule-based assessment** | Check assessment completeness, calculate NEWS2 and identify conditions requiring attention through separate rules. | Save versioned NEWS2 component scores, the complete total score and risk classification; custom system rules separately retain alert reasons, triggering evidence and associated procedures. |
| **Layer 2 — Personalized statistical analysis** | Understand how a reading differs from that crew member's usual state. | Establish fixed baselines from historical readings with matching sources, methods and contexts. Manage candidate review, activation, freezing and rebuilding, and save versioned Z-scores and EWMA per measurement. |
| **Layer 3 — LLM + RAG explanations** | Turn measurements, assessment results and retrieved knowledge into explanations crew members can understand. | Save three-layer reports that pin measurement, scoring, baseline-analysis and knowledge versions. Explain the same authorized evidence and attach traceable sources. |

Layer 1 calculates seven components from the six physiological parameters and supplemental oxygen information in RCP NEWS2 (2017). Complete, usable inputs produce a total score; the official classification rules determine the saved risk band and single-component scores of three. Data-quality and time-window checks, decimal-input normalization, visual indicators and onboard alerts are separate system designs. These engineering policies and workflows are not part of the official RCP specification, and displaying a NEWS2 risk band does not automatically trigger an onboard notification. [Royal College of Physicians NEWS2 reference](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/)

Layer 2 accounts for individual differences. The same heart rate can represent different deviations for two crew members. A Z-score expresses the difference from a personal mean in standard deviations. EWMA smooths successive deviations to help reveal whether a change persists.

Layer 3 uses a large language model (LLM) with retrieval-augmented generation (RAG) to explain a saved three-layer assessment report. A crew member can ask which record supports an explanation or what is missing from the assessment, then open the record or procedure card cited by that same report. AI explanations do not rewrite saved scores, baselines or evidence.

The diagram shows the data flow through assessment, saved reports and explanations.

```mermaid
flowchart TD
    A["Health measurements and personal records"] --> B["Data quality, timing and context checks"]
    B --> C["Layer 1: Rules and scoring"]
    B --> D["Layer 2: Personal reference and statistics"]
    C --> R["Save three-layer report and evidence versions"]
    D --> R
    K["Versioned local knowledge and procedure cards"] --> R
    R --> E["Layer 3: LLM + RAG explanations"]
    C -->|Custom alert rules| F["Alerts and crew notifications"]
    E --> G["Source-linked explanations and action links"]
```

### Completed implementation as of 2026-11-15

- **Layer 1** implements seven NEWS2 component scores, the complete total score, risk classification and single-component scores of three, retaining scoring, interpretation and input-normalization versions. The 8/8 indicator means required-input completeness; missing, poor-quality or out-of-window inputs, or disabled scoring, leave the total unavailable rather than zero. Synthetic heart-rate alerts use separate system rules.
- **Layer 2** supports six fixed personal baselines: heart rate, SpO₂, respiratory rate, systolic pressure, diastolic pressure and temperature. It provides candidate review and activation, freezing, resumption, rebuilding, retirement, exclusion periods and an audit history. Each analysis retains its measurement, baseline version, Z-score and EWMA; explicit recalculation saves a new revision without rewriting historical evidence.
- **Layer 3** saves three-layer assessment reports that pin the selected NEWS2 version, precisely linked measurements and baseline analyses, rule evidence, and knowledge and procedure versions. The assistant explains the same report and preserves its snapshot across follow-up questions; offline, timed-out or rejected model output falls back to local evidence. Full reports are owner-only, while monitoring staff can view authorized summaries.

After saving an observation on the NEWS2 page, save a three-layer assessment and ask the assistant about that report. NEWS2, personal statistics and AI explanations remain separate rather than becoming a single combined health score. This completed implementation covers synthetic-data training features; it does not establish clinical validation or acceptance for deployment on a space mission.

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
- **Telemetry playback fallback:** start the medical and cabin services, then open `http://127.0.0.1:4173/playback.html` to loop synthetic readings into the crew phones and shared board. Stopping playback lets readings become stale while preserving history.

| File | Purpose |
| --- | --- |
| [60-second dataset](astro-hiyoko-demo/data/crew-health-sample60.zip) | Five-crew synthetic telemetry loaded directly by the player: 300 packets and 1,215 metrics per cycle. Demonstrates the data flow without hardware; it is not the historical JSON import format. |
| [Historical JSON example](health-system/examples/crew-dataset.example.json) | Select this file in the monitoring station's dataset importer to demonstrate the `crew-dataset/1` historical format. |

`health-system/backend/radiation*.py` implements accumulation, persistence and APIs; `dataset_import.py` and `body_import.py` handle imports. `RadiationPanel.tsx` and `DatasetImport.tsx` provide the medical UI; `astro-hiyoko-demo/radiation-monitor.js` connects the cabin display. See the [health-system guide](health-system/README.md) and [cabin guide](astro-hiyoko-demo/README.md).

## Hardware simulation

- **Wokwi circuit simulation:** Interactive simulation of the ESP32-based biomedical sensing system, including sensor connections and firmware.

  [Wokwi Simulation](https://wokwi.com/projects/480433596780917761)

- **Telemetry firmware and backend integration:** The [firmware guide](firmware/README.md) explains how the ESP32 gateway sends synthetic data for five crew members to the medical backend, including the packet format, Wokwi setup, verification results and current limitations.
