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

Each crew member follows a schedule of rest, duty, exercise and meals. In connected mode, Lin is on flight duty, Kai inspects systems, Mira does resistance training, Noa cycles and Sol checks on the crew. The standalone scenario uses Hana, Kai, Mira, Leo and Yuna.

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
