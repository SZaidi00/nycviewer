/**
 * NYC 3D Subway Viewer
 *
 * Two worlds, one elevator:
 *  - Above ground: Mapbox GL JS base map with clean white 3D buildings.
 *  - Below ground: a fully custom Three.js scene (own canvas, own camera)
 *    with subway tubes at true negative depths, fog and glow.
 * The depth elevator crossfades between them — no Mapbox/Three.js
 * renderer interop, so depth testing just works.
 */

// ============================
// CONFIGURATION
// ============================

const MANHATTAN_CENTER = [-73.985, 40.754]; // ~Times Square / Midtown
const CITY_VIEW = { center: MANHATTAN_CENTER, zoom: 13.2, pitch: 55, bearing: -15 };

const MAX_DISPLAY_DEPTH = 60; // meters — bottom of the elevator track
const UNDERGROUND_BG = 0x0d1117;

const ROUTE_CONFIG = {
  // IRT – oldest, generally shallower
  '1': { color: '#EE352E', depth: -28, system: 'IRT' },
  '2': { color: '#EE352E', depth: -28, system: 'IRT' },
  '3': { color: '#EE352E', depth: -28, system: 'IRT' },
  '4': { color: '#00933C', depth: -26, system: 'IRT' },
  '5': { color: '#00933C', depth: -26, system: 'IRT' },
  '6': { color: '#00933C', depth: -26, system: 'IRT' },
  '6X': { color: '#00933C', depth: -26, system: 'IRT' },
  '7': { color: '#B933AD', depth: -32, system: 'IRT' },
  '7X': { color: '#B933AD', depth: -32, system: 'IRT' },
  'GS': { color: '#808183', depth: -20, system: 'IRT' },
  'FS': { color: '#808183', depth: -20, system: 'IRT' },
  'H':  { color: '#808183', depth: -20, system: 'IRT' },

  // BMT – mid-depth
  'N': { color: '#FCCC0A', depth: -42, system: 'BMT' },
  'Q': { color: '#FCCC0A', depth: -42, system: 'BMT' },
  'R': { color: '#FCCC0A', depth: -42, system: 'BMT' },
  'W': { color: '#FCCC0A', depth: -42, system: 'BMT' },
  'J': { color: '#996633', depth: -38, system: 'BMT' },
  'Z': { color: '#996633', depth: -38, system: 'BMT' },
  'L': { color: '#A7A9AC', depth: -35, system: 'BMT' },

  // IND – deepest (built 1930s to avoid existing lines)
  'A': { color: '#0039A6', depth: -58, system: 'IND' },
  'C': { color: '#0039A6', depth: -58, system: 'IND' },
  'E': { color: '#0039A6', depth: -58, system: 'IND' },
  'B': { color: '#FF6319', depth: -55, system: 'IND' },
  'D': { color: '#FF6319', depth: -55, system: 'IND' },
  'F': { color: '#FF6319', depth: -55, system: 'IND' },
  'FX': { color: '#FF6319', depth: -55, system: 'IND' },
  'M': { color: '#FF6319', depth: -55, system: 'IND' },
  'G': { color: '#6CBE45', depth: -22, system: 'IND' },

  // SIR
  'SI': { color: '#053F7E', depth: -18, system: 'SIR' },
};

const TUBE_RADIUS = 15; // meters — exaggerated for visibility
const STATION_RADIUS = 14; // meters — exaggerated for visibility
const TUBE_RADIAL_SEGMENTS = 10;

// ============================
// UTILITIES
// ============================

function getRouteConfig(routeId) {
  if (ROUTE_CONFIG[routeId]) return ROUTE_CONFIG[routeId];
  // Try to extract single letter/number from combined names like "1-2-3"
  const cleaned = routeId.replace(/[^A-Z0-9]/gi, '');
  for (const char of cleaned) {
    if (ROUTE_CONFIG[char]) return ROUTE_CONFIG[char];
  }
  return { color: '#888888', depth: -35, system: 'UNKNOWN' };
}

// Short display label for a route id ("6X" -> "6", "GS"/"FS" -> "S", "SI" -> "SIR")
function routeLabel(routeId) {
  if (routeId === 'SI') return 'SIR';
  if (routeId === 'GS' || routeId === 'FS') return 'S';
  return routeId.replace(/X$/, '');
}

function lngLatToMeters(lngLat, centerLngLat) {
  const R = 6371000;
  const dLat = (lngLat[1] - centerLngLat[1]) * Math.PI / 180;
  const dLng = (lngLat[0] - centerLngLat[0]) * Math.PI / 180;
  const latAvg = ((lngLat[1] + centerLngLat[1]) / 2) * Math.PI / 180;
  const x = dLng * R * Math.cos(latAvg);
  const z = dLat * R;
  return { x, z };
}

// Rough Manhattan bounds to filter subway data
const MANHATTAN_BOUNDS = {
  west: -74.02, east: -73.93, south: 40.70, north: 40.88
};

function isInManhattan(coords) {
  const lng = coords[0];
  const lat = coords[1];
  return (
    lng >= MANHATTAN_BOUNDS.west &&
    lng <= MANHATTAN_BOUNDS.east &&
    lat >= MANHATTAN_BOUNDS.south &&
    lat <= MANHATTAN_BOUNDS.north
  );
}

// ============================
// UNDERGROUND SCENE (pure Three.js)
// ============================

class UndergroundScene {
  constructor(canvas, lineData, stationData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(UNDERGROUND_BG);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(UNDERGROUND_BG, 6000, 18000);

    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 10, 80000
    );

    this.controls = new THREE.OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 400;
    this.controls.maxDistance = 26000;
    // Allow orbiting below street level — into the tunnels
    this.controls.maxPolarAngle = Math.PI * 0.92;

    // Lighting: bright ambient + soft directional; tubes also self-glow
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLight.position.set(1, 2, 1);
    this.scene.add(dirLight);

    // Reference: faint street grid + translucent slab at ground level (y = 0)
    const grid = new THREE.GridHelper(26000, 52, 0x2b3546, 0x1a2230);
    grid.position.y = 0;
    this.scene.add(grid);

    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(26000, 26000),
      new THREE.MeshBasicMaterial({
        color: 0x11161f, transparent: true, opacity: 0.35, depthWrite: false,
      })
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = 4; // just above the grid to avoid z-fighting
    this.scene.add(slab);

    // Per-system groups so lines can be isolated
    this.systemGroups = {};

    this._buildSubwayTubes(lineData);
    this._buildStationMarkers(stationData);

    this.resetCamera();

    window.addEventListener('resize', () => this._onResize());
  }

  _groupFor(system) {
    if (!this.systemGroups[system]) {
      const group = new THREE.Group();
      this.systemGroups[system] = group;
      this.scene.add(group);
    }
    return this.systemGroups[system];
  }

  // lng/lat -> Three.js position: X = east, Y = up (depth is negative), Z = south
  _toScene(coord, depth) {
    const offset = lngLatToMeters(coord, MANHATTAN_CENTER);
    return new THREE.Vector3(offset.x, depth, -offset.z);
  }

  _buildSubwayTubes(lineData) {
    const features = lineData.features || [];
    let builtCount = 0;

    features.forEach((feature) => {
      const props = feature.properties || {};
      const routeId = props.rt_symbol || props.route_id || '';
      const config = getRouteConfig(routeId);
      const color = props.color || config.color;
      const depth = config.depth;

      const geometryType = feature.geometry?.type;
      const coords = feature.geometry?.coordinates;
      if (!coords) return;

      const segments = geometryType === 'LineString' ? [coords] : coords;

      segments.forEach((segment) => {
        if (segment.length < 2) return;
        if (!segment.some((c) => isInManhattan(c))) return;

        const points = segment.map((coord, i) => {
          const variation = Math.sin(i * 0.4 + (routeId.charCodeAt(0) || 0)) * 4;
          return this._toScene(coord, depth + variation);
        });

        const curve = new THREE.CatmullRomCurve3(points);
        curve.curveType = 'catmullrom';
        curve.tension = 0.5;

        const tubeGeo = new THREE.TubeGeometry(
          curve,
          Math.max(points.length * 2, 8),
          TUBE_RADIUS,
          TUBE_RADIAL_SEGMENTS,
          false
        );

        const material = new THREE.MeshPhongMaterial({
          color: color,
          emissive: color,
          emissiveIntensity: 0.35,
          shininess: 60,
        });

        this._groupFor(config.system).add(new THREE.Mesh(tubeGeo, material));
        builtCount++;
      });
    });

    console.log(`[Underground] Built ${builtCount} tube segments`);
  }

  _buildStationMarkers(stationData) {
    const features = stationData.features || [];
    const seen = new Set();
    let builtCount = 0;

    features.forEach((feature) => {
      const props = feature.properties || {};
      const routeId = props.rt_symbol || props.route_id || '';
      const config = getRouteConfig(routeId);
      const color = props.color || config.color;
      const coords = feature.geometry?.coordinates;
      if (!coords || !isInManhattan(coords)) return;

      // Deduplicate by rounded coordinates (~11m precision)
      const key = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}-${routeId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const depth = config.depth + Math.sin(coords[0] * 10) * 3;

      const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.6,
        shininess: 80,
      });

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(STATION_RADIUS, 14, 14), material
      );
      mesh.position.copy(this._toScene(coords, depth));
      this._groupFor(config.system).add(mesh);
      builtCount++;
    });

    console.log(`[Underground] Built ${builtCount} station markers`);
  }

  // Dim every system except the selected one (null = show all)
  isolateSystem(system) {
    Object.entries(this.systemGroups).forEach(([sys, group]) => {
      const active = !system || sys === system;
      group.children.forEach((mesh) => {
        const m = mesh.material;
        m.transparent = !active;
        m.opacity = active ? 1 : 0.06;
        m.depthWrite = active;
        m.needsUpdate = true;
      });
    });
  }

  resetCamera() {
    this.camera.position.set(-2000, 4500, 7500);
    this.controls.target.set(0, -35, 0);
    this.controls.update();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ============================
// MAP SETUP (above-ground world)
// ============================

let map;
let underground = null;
let undergroundActive = false;

function getToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken) return urlToken;
  return localStorage.getItem('nycviewer_mapbox_token');
}

function saveToken(token) {
  const saveCheckbox = document.getElementById('save-token');
  if (saveCheckbox && saveCheckbox.checked) {
    localStorage.setItem('nycviewer_mapbox_token', token);
  }
}

function initMap(token) {
  mapboxgl.accessToken = token;

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v11',
    center: CITY_VIEW.center,
    zoom: CITY_VIEW.zoom,
    pitch: CITY_VIEW.pitch,
    bearing: CITY_VIEW.bearing,
    antialias: true,
    maxPitch: 85,
  });

  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

  map.on('error', (e) => {
    console.error('Mapbox error:', e);
    if (e.error && e.error.status === 401) {
      alert('Invalid Mapbox token. Please check your token and try again.');
      localStorage.removeItem('nycviewer_mapbox_token');
      location.reload();
    }
  });

  map.on('style.load', () => {
    add3DBuildings();
    loadSubwayData();
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    if (descendT < 0.5) {
      map.flyTo({ ...CITY_VIEW, duration: 1500 });
    } else if (underground) {
      underground.resetCamera();
    }
  });

  document.getElementById('panel-toggle').addEventListener('click', () => {
    document.getElementById('side-panel').classList.toggle('collapsed');
  });

  initElevator();
}

function add3DBuildings() {
  const style = map.getStyle();
  if (!style || !style.layers) {
    console.warn('[Buildings] Style not ready');
    return;
  }

  // Hide any flat 2D building layers so they don't fight with 3D extrusions
  style.layers.forEach((layer) => {
    if (
      layer.type === 'fill' &&
      (layer.id.includes('building') || layer['source-layer'] === 'building')
    ) {
      try {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      } catch (e) { /* ignore */ }
    }
  });

  // Recolor any existing 3D building layers to clean white
  style.layers
    .filter((l) =>
      l.type === 'fill-extrusion' &&
      (l.id.includes('building') || l['source-layer'] === 'building'))
    .forEach((layer) => {
      try {
        map.setPaintProperty(layer.id, 'fill-extrusion-color', '#ffffff');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty(layer.id, 'fill-extrusion-vertical-gradient', true);
        const h = map.getPaintProperty(layer.id, 'fill-extrusion-height');
        if (h) map.setPaintProperty(layer.id, 'fill-extrusion-height', ['*', 1.1, h]);
      } catch (e) {
        console.warn('[Buildings] Could not modify layer', layer.id, e.message);
      }
    });

  // Add a dedicated high-quality building layer from the composite source
  let insertBefore = null;
  for (const layer of style.layers) {
    if (layer.type === 'symbol') { insertBefore = layer.id; break; }
  }

  try {
    const newLayer = {
      id: '3d-buildings-custom',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['get', 'extrude'], 'true'],
      type: 'fill-extrusion',
      minzoom: 10,
      paint: {
        'fill-extrusion-color': '#ffffff',
        'fill-extrusion-height': ['*', 1.1, ['get', 'height']],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 1.0,
        'fill-extrusion-vertical-gradient': true,
      },
    };
    if (insertBefore) map.addLayer(newLayer, insertBefore);
    else map.addLayer(newLayer);
    console.log('[Buildings] Added custom building layer');
  } catch (e) {
    console.warn('[Buildings] Could not add custom building layer:', e.message);
  }

  // Lighten land/background layers so white buildings stand out
  style.layers.forEach((layer) => {
    if (layer.id.includes('land') || layer.id === 'background') {
      try {
        if (map.getPaintProperty(layer.id, 'background-color') !== undefined) {
          map.setPaintProperty(layer.id, 'background-color', '#e8e8e8');
        }
        if (map.getPaintProperty(layer.id, 'fill-color') !== undefined) {
          map.setPaintProperty(layer.id, 'fill-color', '#e8e8e8');
        }
      } catch (e) { /* ignore */ }
    }
  });
}

// ============================
// DATA LOADING & LEGEND
// ============================

async function loadSubwayData() {
  const loadingOverlay = document.getElementById('loading-overlay');
  loadingOverlay.classList.remove('hidden');

  try {
    const [linesRes, stationsRes] = await Promise.all([
      fetch('subway-lines.json'),
      fetch('subway-stations.json'),
    ]);

    if (!linesRes.ok || !stationsRes.ok) {
      throw new Error('Failed to load subway data files');
    }

    const linesData = await linesRes.json();
    const stationsData = await stationsRes.json();

    console.log('[Data] Loaded', linesData.features?.length || 0, 'line features');
    console.log('[Data] Loaded', stationsData.features?.length || 0, 'station features');

    // Build the custom underground world
    underground = new UndergroundScene(
      document.getElementById('underground-canvas'), linesData, stationsData
    );
    applyDescend(descendT); // sync crossfade + visibility with current state
    startRenderLoop();

    buildLegend(linesData, stationsData);

    loadingOverlay.classList.add('hidden');
    document.getElementById('ui-controls').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    const panel = loadingOverlay.querySelector('.panel');
    panel.innerHTML = `
      <p style="color:#EE352E;margin-bottom:12px;">Error loading subway data.</p>
      <p style="font-size:12px;color:#666;margin-bottom:12px;">${err.message}</p>
      <button onclick="location.reload()">Retry</button>
    `;
  }
}

function buildLegend(linesData, stationsData) {
  const legend = document.getElementById('route-legend');
  const seen = new Set();
  const groups = {}; // system -> [{ routeId, color }]

  const features = [
    ...(linesData.features || []),
    ...(stationsData.features || []),
  ];

  features.forEach((f) => {
    const routeId = f.properties?.rt_symbol || '';
    if (!routeId || seen.has(routeId)) return;
    seen.add(routeId);

    const config = getRouteConfig(routeId);
    if (!groups[config.system]) groups[config.system] = [];
    groups[config.system].push({ routeId, color: f.properties?.color || config.color });
  });

  ['IRT', 'BMT', 'IND', 'SIR', 'UNKNOWN'].forEach((system) => {
    const routes = groups[system];
    if (!routes || routes.length === 0) return;

    const group = document.createElement('div');
    group.className = 'legend-group clickable';
    group.dataset.system = system;
    group.title = `Isolate ${system} lines`;

    const label = document.createElement('span');
    label.className = 'legend-system';
    label.textContent = system;

    const badges = document.createElement('div');
    badges.className = 'legend-badges';

    routes.forEach(({ routeId, color }) => {
      const badge = document.createElement('span');
      badge.className = 'route-badge';
      badge.style.backgroundColor = color;
      badge.textContent = routeLabel(routeId);
      // Light-colored bullets (N/Q/R/W yellow, L gray) need dark text
      if (['#FCCC0A', '#A7A9AC'].includes(color.toUpperCase())) {
        badge.classList.add('needs-dark-text');
      }
      badges.appendChild(badge);
    });

    group.addEventListener('click', () => {
      setIsolation(isolatedSystem === system ? null : system);
    });

    group.appendChild(label);
    group.appendChild(badges);
    legend.appendChild(group);
  });
}

// ============================
// DEPTH ELEVATOR & CROSSFADE
// ============================

let descendT = 0; // 0 = street level, 1 = deepest view
let isolatedSystem = null;

function applyDescend(t, { fly = false } = {}) {
  descendT = t;
  const blend = Math.min(t / 0.33, 1); // worlds fully crossfade over the first third

  // Crossfade the two worlds
  map.getContainer().style.opacity = 1 - blend;
  const undergroundEl = document.getElementById('underground');
  undergroundEl.style.opacity = blend;
  undergroundActive = t > 0.02;
  undergroundEl.style.pointerEvents = blend > 0.5 ? 'auto' : 'none';

  // UI chrome theme + thumb position + level readout
  document.getElementById('ui-controls').classList.toggle('underground', blend > 0.5);
  document.getElementById('elevator-thumb').style.top = `${t * 100}%`;
  document.getElementById('elevator-cap').textContent =
    t < 0.02 ? 'Street level' : `−${Math.round(t * MAX_DISPLAY_DEPTH)} m`;

  // Returning to the surface: fly back to the city vantage point
  if (fly && t < 0.5) {
    map.flyTo({ ...CITY_VIEW, duration: 1400 });
  }
}

function setIsolation(system) {
  isolatedSystem = system;
  if (underground) underground.isolateSystem(system);

  document.querySelectorAll('.legend-group[data-system]').forEach((g) => {
    g.classList.toggle('dimmed', !!system && g.dataset.system !== system);
  });
  document.querySelectorAll('.elevator-stop').forEach((s) => {
    s.classList.toggle('active', s.dataset.system === system);
  });

  // Isolating from street level takes you down
  if (system && descendT < 0.34) applyDescend(1, { fly: true });
}

function hideDescendHint() {
  const hint = document.getElementById('descend-hint');
  if (hint) hint.classList.add('hidden');
}

function initElevator() {
  const track = document.getElementById('elevator-track');
  let dragging = false;
  let moved = false;

  const tFromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    return Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
  };

  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    track.classList.remove('snapping');
    track.setPointerCapture(e.pointerId);
    hideDescendHint();
    applyDescend(tFromEvent(e));
  });

  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    applyDescend(tFromEvent(e));
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.add('snapping');
    applyDescend(descendT < 0.25 ? 0 : 1, { fly: true });
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // Depth stops: jump to a system level and isolate it
  document.querySelectorAll('.elevator-stop').forEach((stop) => {
    stop.addEventListener('click', () => {
      if (moved) return; // was a drag, not a tap
      const system = stop.dataset.system;
      const depth = parseFloat(stop.dataset.depth);
      track.classList.add('snapping');
      hideDescendHint();
      applyDescend(Math.max(depth, 0.34), { fly: true });
      setIsolation(isolatedSystem === system ? null : system);
    });
  });
}

// Render loop — only draws the underground scene while it's on screen
function startRenderLoop() {
  function animate() {
    requestAnimationFrame(animate);
    if (undergroundActive && underground) underground.render();
  }
  animate();
}

// ============================
// INITIALIZATION
// ============================

function init() {
  const token = getToken();

  if (token) {
    document.getElementById('token-overlay').classList.add('hidden');
    initMap(token);
  } else {
    document.getElementById('load-map-btn').addEventListener('click', () => {
      const input = document.getElementById('token-input');
      const val = input.value.trim();
      if (val && val.startsWith('pk.')) {
        saveToken(val);
        document.getElementById('token-overlay').classList.add('hidden');
        initMap(val);
      } else {
        input.style.borderColor = '#EE352E';
        input.placeholder = 'Please enter a valid Mapbox token';
      }
    });

    document.getElementById('token-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('load-map-btn').click();
      }
    });
  }
}

init();
