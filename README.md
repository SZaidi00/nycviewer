# NYC 3D Subway Viewer

A frontend-only web app that visualizes Manhattan in 3D — white buildings above ground and MTA subway routes below ground — as **two worlds connected by a depth elevator**.

## What it shows

- **Above ground (Mapbox GL):** Clean white 3D buildings on a light base map, styled like Apple Maps' 3D view
- **Below ground (custom Three.js scene):** MTA subway lines as glowing 3D tubes at true negative depths, with distance fog, a faint street-grid plane at 0 m for reference, and a free orbit camera that can dive right into the tunnels
- **Depth elevator:** A vertical control on the right edge — drag the knob down to descend and the city crossfades into the underground scene. Depth stops mark the real system levels (IRT ~25 m, BMT ~40 m, IND ~55 m); tap one to jump to that level and isolate its lines
- **System isolation:** Click a system row in the legend (or a depth stop) to dim every other system to a ghost

## Why two renderers

The underground view is deliberately **not** a Mapbox custom layer. Mapbox GL's renderer can't reliably depth-test custom content against its own ground plane (the tubes either vanish or float on top), and its camera can't go below the street. The underground scene is a standalone Three.js world with its own canvas and camera, crossfaded in by the elevator — so depth, fog and glow all behave exactly as they should.

## Subway depth logic

Routes are placed at approximate realistic depths based on the historical subway system:

| System | Built | Typical Depth |
|--------|-------|---------------|
| IRT (1,2,3,4,5,6,7,S) | 1904–1920s | ~25m |
| BMT (N,Q,R,W,J,Z,L) | 1915–1920s | ~40m |
| IND (A,C,E,B,D,F,M,G) | 1930s | ~55m |

Each line also has slight sinusoidal variation along its path so it doesn't look perfectly flat.

## Tech stack

- **Mapbox GL JS v3** — above-ground base map, navigation, and 3D building extrusions
- **Three.js r128 + OrbitControls** — standalone underground scene (tubes, stations, fog, grid)
- **NYC OpenData** — local GeoJSON for subway lines and stations (no backend required)

## Running locally

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node
npx serve .
```

Then open `http://localhost:8080`.

## Mapbox token

You'll need a free Mapbox access token for the above-ground city. Get one at [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/).

You can provide it via:
1. The on-screen prompt (optionally saved to localStorage)
2. URL parameter: `?token=pk.your_token_here`

## Controls

| Action | Control |
|--------|---------|
| Descend / ascend | Drag the elevator knob on the right edge |
| Jump to a system's depth | Click a depth stop (IRT / BMT / IND) |
| Isolate a system | Click its legend row or depth stop (click again to clear) |
| Rotate / orbit | Left click + drag |
| Pan | Right click + drag |
| Zoom | Scroll |

Click **Reset view** (bottom right) to return to the default camera for the current world.

## Notes

- This is a personal visualization project. Subway depths are approximate and simplified.
- All data is fetched client-side from NYC OpenData.
- The app is optimized for desktop browsers with WebGL support.
