# NYC 3D Subway Viewer

A frontend-only web app that visualizes Manhattan in 3D — white buildings above ground and MTA subway routes below ground, all in one continuous scene.

## What it shows

- **Above ground:** Clean white 3D buildings (styled like Apple Maps' 3D view, no satellite imagery)
- **Below ground:** MTA subway lines rendered as true 3D tubes at varying depths, visible through the street surface (x-ray style)
- **View toggle:** A switch at the top of the screen jumps between the **above-ground** view (solid white city) and the **below-ground** view (buildings fade to a ghost outline so the full subway network shows through)
- **Stations:** Small colored spheres along each route
- **360° navigation:** Rotate, pitch, zoom, and pan freely to see both layers from any angle

## Subway depth logic

Routes are placed at approximate realistic depths based on the historical subway system:

| System | Built | Typical Depth |
|--------|-------|---------------|
| IRT (1,2,3,4,5,6,7,S) | 1904–1920s | ~25m |
| BMT (N,Q,R,W,J,Z,L) | 1915–1920s | ~40m |
| IND (A,C,E,B,D,F,M,G) | 1930s | ~55m |

Each line also has slight sinusoidal variation along its path so it doesn't look perfectly flat.

## Tech stack

- **Mapbox GL JS v3** — base map, navigation, and 3D building extrusions
- **Three.js r128** — custom Mapbox layer for 3D subway tubes and station spheres
- **NYC OpenData** — live GeoJSON for subway lines and stations (no backend required)

## Running locally

```bash
# Option 1: Python
python3 -m http.server 8085

# Option 2: Node
npx serve .
```

Then open `http://localhost:8085`.

## Mapbox token

You'll need a free Mapbox access token to run this. Get one at [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/).

You can provide it via:
1. The on-screen prompt (optionally saved to localStorage)
2. URL parameter: `?token=pk.your_token_here`

## Controls

| Action | Control |
|--------|---------|
| Rotate | Left click + drag |
| Pan | Right click + drag |
| Zoom | Scroll |
| Tilt / pitch | Ctrl + drag (or right-click drag on some setups) |
| Switch above/below ground | Toggle at the top of the screen |

Click **Reset view** (bottom right) to return to the default vantage point for the current mode.

## Notes

- This is a personal visualization project. Subway depths are approximate and simplified.
- All data is fetched client-side from NYC OpenData.
- The app is optimized for desktop browsers with WebGL support.
