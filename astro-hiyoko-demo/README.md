# Astro Hiyoko 3D habitat

**English** | [繁體中文](README.zh-TW.md)

Explore the crew quarters, training area and commons in a Three.js spacecraft. Each of the five crew phones opens its owner’s health app. The commons wall shows heart rate, oxygen saturation, blood pressure, temperature and the latest alert. Click the wall to open the full crew board.

## Start the cabin

Use Node.js 24, npm and a browser with WebGL 2 support. For the connected cabin, first install the [crew health system](../health-system/README.md). Open PowerShell in the repository root and start the medical service.

```powershell
.\health-system\start.cmd
```

Open another PowerShell window at the repository root for the cabin. Run `npm.cmd ci` on the first launch.

```powershell
cd .\astro-hiyoko-demo
npm.cmd ci
npm.cmd start
```

The connected cabin opens on port 4173 and expects the medical service on port 8000. If you change `HEALTH_PORT` or `HEALTH_DEMO_PASSWORD`, set the same value in both windows before starting the services. Each cabin device has its own sign-in session. [Enter the connected cabin](http://127.0.0.1:4173/)

Each phone's home screen includes **My body** with the current hologram thumbnail. Open it, or choose **Body hologram** from the phone's navigation, to rotate the body, switch muscle/fat layers, inspect injuries and compare saved scans inside the device. After upgrading, run `npm.cmd run build` in `health-system/web`, restart both the medical and cabin services, then reopen the phone. `health-system/start.cmd` enables synthetic scans by default; direct uvicorn launches need `HEALTH_BODY_SCAN_DEMO=1`. Use **Simulate scan** for the first record and save a second to compare. Records in a separate preview database are not copied into the original devices.

Run `npm.cmd run test:body` for the isolated original-phone entry tests.

To use the standalone simulation, start just the cabin server and open the simulation URL. The scripted readings and events stay in the current browser tab. [Enter the standalone simulation](http://127.0.0.1:4173/?mode=simulation)

## Show a crew member requesting help

1. Open the connected cabin and use **Go to area** to enter the commons. Leave the wall in view and wait for **Live**. A dash indicates a missing reading, an asterisk marks a stale one, and an offline wall shows the last sync time.
2. In a second cabin window, open Mira’s phone from **Crew devices** and select **Request help**. With one window, close the phone after sending the request to see the wall again.
3. The wall displays **Mira · Manual help request** with its UTC time. Click the wall for the full board. The phones belong to Lin, Kai, Mira, Noa and Sol. The wall uses the read-only `display` account.

## Explore the habitat

| Control | Inside | Outside |
| --- | --- | --- |
| Left drag | Look around | Orbit the ship |
| Right drag | Pan horizontally | Pan horizontally |
| Scroll | Move forward or backward | Zoom |
| WASD or arrow keys | Move relative to the camera | — |
| Q / E | Descend / ascend | — |
| Reset view | Return to the central corridor | Return to the central corridor |

Use the area menu to jump to the cockpit, a crew berth, the commons, the gym or the equipment bay. Click a crew member or their phone to open the device. Click the commons display to enlarge it. Press **Esc** to return to the scene. **Exterior view** takes you outside the hull. The **ⓘ** panel explains the controls and data sources.

The interior camera can pass through partitions. Forward and backward movement stays level when you look up or down. The five private quarters each have a sleeping bag, desk, storage and handholds. The central corridor links the cockpit, dining and water stations, gym, equipment racks and airlock. Outside, you can see the solar panels, curved hull and three thrusters.

Connected-mode activities come from the medical backend's committed playback state for Mira, Kai, Lin, Noa and Sol. The five-minute script includes Kai's exercise/recovery, Lin's transient resting abnormality, Noa's gradual baseline deviation and Sol's poor/missing input; activity timing follows the same saved clock as their measurements. The independent standalone scenario uses Hana, Kai, Mira, Leo and Yuna and its own schedule.

## Run a scripted scenario

In standalone mode, press **F** to open the scenario panel. Choose a crew member and event, then select **Trigger simulated event**. Use the panel to visit the event, open the phone or inspect the shared screen. The **•••** menu also offers pause, 1×/4×/12× speed and reset.

| Scenario | What appears in the cabin |
| --- | --- |
| Crew member collapses | The selected character stops and falls. Their phone and the shared screen show the scripted fall flag, 48 bpm and 94% oxygen saturation. |
| Abnormal heart rate | The selected crew member’s simulated rate changes to 112 bpm and the screens show an alert. |
| Device offline | The device is marked missing. Its heart rate, oxygen saturation and temperature fields show missing values. |
| Environmental radiation warning | The cabin lighting and shared display flag a ship-wide event. Each phone receives an environmental notice. |

The phones and shared screen read the same state. Each simulated second updates the crew member’s activity, synthetic readings, sequence number and simulation timestamp. Pausing or changing speed affects the crew routines, readings and event sequence together.

A scripted event progresses from sensor to phone to shared screen at two-second intervals and can be acknowledged after six simulated seconds. Acknowledgement records that the event was seen. The event stays active on screen until you clear it or start another scenario. Reset returns the crew routines and simulation clock to their starting point.

## References and assets

- Cockpit and habitation references. [NASA’s Orion overview](https://www.nasa.gov/missions/meet-nasas-orion-spacecraft/)
- Sleeping restraints and private storage. [ESA sleeping quarters](https://www.esa.int/media/sleeping-quarters)
- Commons, airlock and exercise equipment. [ESA interior tour of the ISS](https://blogs.esa.int/luca-parmitano/2013/11/06/guide-to-the-international-space-station-for-the-occasional-visitor-part-2/)
- Earth and Moon textures are bundled in `assets/`. [Three.js Earth texture](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg) · [Three.js Moon texture](https://threejs.org/examples/textures/planets/moon_1024.jpg)

## Radiation monitoring and telemetry fallback

Start both services and choose **More → Open radiation monitor** to see the shared mission rate and accumulated dose. Crew phones show individual prior exposure. Browser reload does not reset the backend mission. Pause/speed controls belong to standalone simulation; connected mode uses the backend clock. All values are Simulation.

The [playback controller](http://127.0.0.1:4173/playback.html) controls a prepared **30-day history + one 300-second run**. Use the [v3 ZIP](../output/health-demo-v3/crew-demo-v3.zip) and the [medical preparation instructions](../health-system/README.md#30-day-history-and-five-minute-playback) to build a separate candidate database before using it. A signed-in `monitor` selects **開始新的示範** or **停止示範**; controls require CSRF. State reads require an authenticated session, and personal profile/assessment summaries require the owner or monitor. The backend owns the clock and persisted progress, so refreshing or closing the tab does not restart or stop playback. Completion retains results; another run requires another manual start. Connected playback has no loop, pause or speed control.

The cabin connects to the medical service and its selected database; preparation does not replace the active database. Stop other senders first; the backend rejects competing mock input during playback. History is anchored to `preparedAt` and playback to its actual `startedAt`, preserving any gap between them. Five crew receive six saved personal baselines each, with separate saved NEWS2, statistical and cited assistant evidence in the medical UI. See the [data contract](../health-system/DATA_DEMO_FORMAT.zh-TW.md) for units, sampling and synthetic provenance. Expected answers are test-only and do not drive playback; synthetic scenarios do not establish clinical accuracy or completed real-device acceptance.

The [legacy 60-second ZIP](data/crew-health-sample60.zip) remains available for the separate `health-system/dataset_player.py --dataset ... --inspect` CLI. This webpage no longer reads that ZIP. The historical JSON importer is also a separate format and workflow.
