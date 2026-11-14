# Astro Hiyoko

**English** | [繁體中文](README.zh-TW.md)

Astro Hiyoko lets you rehearse a crew health incident aboard a virtual spacecraft. Five fictional crew members share a medical system. Open it directly to record a measurement, or step inside the 3D habitat and watch a request for help travel from a crew member’s phone to the commons wall.

| Project | What you can do |
| --- | --- |
| [Crew health system](health-system/README.md) | Record heart rate, oxygen saturation, blood pressure and temperature. Crew members can review trends and daily training. A monitoring station and a read-only board show updates across the crew. |
| [3D habitat demo](astro-hiyoko-demo/README.md) | Explore the spacecraft, open crew phones and watch the commons display. The cabin connects to the health system by default. A standalone mode runs four scripted scenarios using synthetic data. |

## Run locally on Windows

Open PowerShell in the repository root. The health system uses Python 3.12, Node.js 24 and npm. The standalone 3D demo needs Node.js, npm and a browser with WebGL 2 support.

### 1. Start the health system

```powershell
.\health-system\setup.cmd   # First run: install dependencies and build the web app
.\health-system\start.cmd
```

Keep this window open. On subsequent runs, use just `.\health-system\start.cmd`. The default training password for all accounts is `orbital-demo`.

| Local page | Account | Use |
| --- | --- | --- |
| [Crew app](http://127.0.0.1:8000/app) | `mira`, `kai`, `lin`, `noa` or `sol` | Record your measurements and training, or request help. |
| [Monitoring station](http://127.0.0.1:8000/system) | `monitor` | Review crew health and measurement history. |
| [Read-only board](http://127.0.0.1:8000/board) | `display` | Show the crew’s latest readings and alerts on a shared screen. |

### 2. Start the 3D habitat

Open a second PowerShell window in the repository root.

```powershell
cd .\astro-hiyoko-demo
npm.cmd ci      # First run only
npm.cmd start
```

- **Connected cabin.** With both services running, open the habitat. Each crew phone signs in to its own account, and the commons wall subscribes to the health board. [Enter the cabin](http://127.0.0.1:4173/)
- **Standalone simulation.** With only the 3D service running, open the simulation and press **F** to select a crew member and a scenario. Events stay in that browser tab. [Run the simulation](http://127.0.0.1:4173/?mode=simulation)

## Show both projects together

1. Open the [connected cabin](http://127.0.0.1:4173/) in two browser windows. In the first, use **Go to area** to enter the commons. Leave the wall in view and wait for **Live**.
2. In the second window, choose **Mira** under **Crew devices**. To demonstrate how readings reach the wall, select **Record measurement → Blood pressure**, enter a sample such as `118/76 mmHg`, preview it and save. Check Mira’s row on the wall in the first window.
3. Return to the overview on Mira’s phone and select **Request help**. The wall shows **Mira · Manual help request** and the event time. Click the wall to open the full read-only board.

When you finish, press `Ctrl+C` in each PowerShell window to stop the services.
