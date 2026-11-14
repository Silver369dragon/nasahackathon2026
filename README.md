# Astro Hiyoko — Astronaut Health Monitoring Software

**English** | [繁體中文](README.zh-TW.md)

Astro Hiyoko is a shipboard health monitoring prototype for the NASA Space Apps challenge [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/).

Crew members can record vital signs, see how their readings change over time and request help from the rest of the crew. The software runs locally and stores measurements in SQLite. Five fictional crew accounts support training with manual entries and simulated sensor data.

## What the health system does

| Crew task | How the software supports it |
| --- | --- |
| Collect vital signs | Record heart rate, oxygen saturation, blood pressure and temperature by hand or send synthetic readings with the sensor simulator. Each record retains its time and source. |
| Review a change | Open a personal trend, compare readings taken under similar conditions and inspect the original measurements. The bilingual health assistant can answer questions about those records and cite the entries it used. |
| Track daily health | Log exercise, measurements and post-exercise self-assessments. A NEWS2 observation form lets crew members save a partial observation and see which inputs are missing. |
| Request help | Send a one-tap alert to crewmates and the monitoring station. The shared board shows who requested help and when. Crew members can also open first-aid training cards locally. |

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
