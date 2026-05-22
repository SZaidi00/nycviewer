/**
 * NYC 3D Subway Viewer
 * Uses Mapbox GL JS for the base map + 3D buildings,
 * and Three.js as a custom layer for 3D subway tubes at depth.
 */

// ============================
// CONFIGURATION
// ============================

const MANHATTAN_CENTER = [-73.985, 40.754]; // ~Times Square / Midtown
const INITIAL_ZOOM = 13.2;
const INITIAL_PITCH = 55;
const INITIAL_BEARING = -15;

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
const STATION_RADIUS = 12; // meters — exaggerated for visibility
const TUBE_RADIAL_SEGMENTS = 8; // cross-section detail
const TUBE_TUBULAR_SEGMENTS = 2; // per original point

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
// THREE.JS CUSTOM MAPBOX LAYER
// ============================

class Subway3DLayer {
  constructor(id, lineData, stationData) {
    this.id = id;
    this.type = 'custom';
    this.renderingMode = '3d';
    this.lineData = lineData;
    this.stationData = stationData;
  }

  onAdd(map, gl) {
    this.map = map;
    this.center = MANHATTAN_CENTER;

    // Three.js setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(1, 1, 1);
    this.scene.add(dirLight);

    // Renderer using Mapbox's GL context
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputEncoding = THREE.sRGBEncoding;

    // Build geometries
    this._buildSubwayTubes();
    this._buildStationMarkers();
  }

  _buildSubwayTubes() {
    const features = this.lineData.features || [];
    let builtCount = 0;

    features.forEach((feature) => {
      const props = feature.properties || {};
      const routeId = props.rt_symbol || props.route_id || '';
      const geoColor = props.color || '';
      const config = getRouteConfig(routeId);
      const color = geoColor || config.color;
      const depth = config.depth;

      const geometryType = feature.geometry?.type;
      const coords = feature.geometry?.coordinates;
      if (!coords) return;

      const segments = geometryType === 'LineString' ? [coords] : coords;

      segments.forEach((segment) => {
        if (segment.length < 2) return;

        // Skip segments that are entirely outside Manhattan
        const anyInManhattan = segment.some((c) => isInManhattan(c));
        if (!anyInManhattan) return;

        const points = segment.map((coord, i) => {
          const variation = Math.sin(i * 0.4 + (routeId.charCodeAt(0) || 0)) * 4;
          const d = depth + variation;
          const offset = lngLatToMeters(coord, this.center);
          // Mapbox custom layer convention: X=east, Y=north, Z=up(altitude)
          return new THREE.Vector3(offset.x, offset.z, d);
        });

        // Create smooth curve
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
          transparent: true,
          opacity: 0.92,
          shininess: 60,
        });

        const mesh = new THREE.Mesh(tubeGeo, material);
        this.scene.add(mesh);
        builtCount++;
      });
    });

    console.log(`[Subway3DLayer] Built ${builtCount} tube segments`);
  }

  _buildStationMarkers() {
    const features = this.stationData.features || [];
    const seen = new Set();
    let builtCount = 0;

    features.forEach((feature) => {
      const props = feature.properties || {};
      const routeId = props.rt_symbol || props.route_id || '';
      const geoColor = props.color || '';
      const config = getRouteConfig(routeId);
      const color = geoColor || config.color;
      const coords = feature.geometry?.coordinates;
      if (!coords) return;

      // Only render stations in Manhattan
      if (!isInManhattan(coords)) return;

      // Deduplicate by rounded coordinates (~11m precision)
      const key = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}-${routeId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const variation = Math.sin(coords[0] * 10) * 3;
      const depth = config.depth + variation;
      const offset = lngLatToMeters(coords, this.center);

      const geometry = new THREE.SphereGeometry(STATION_RADIUS, 12, 12);
      const material = new THREE.MeshPhongMaterial({
        color: color,
        transparent: true,
        opacity: 0.95,
        emissive: color,
        emissiveIntensity: 0.3,
      });

      const mesh = new THREE.Mesh(geometry, material);
      // Mapbox custom layer convention: X=east, Y=north, Z=up(altitude)
      mesh.position.set(offset.x, offset.z, depth);
      this.scene.add(mesh);
      builtCount++;
    });

    console.log(`[Subway3DLayer] Built ${builtCount} station markers`);
  }

  render(gl, matrix) {
    const centerMerc = mapboxgl.MercatorCoordinate.fromLngLat(this.center, 0);
    const scale = centerMerc.meterInMercatorCoordinateUnits();

    // Build model matrix that converts local meters (X=east, Y=north, Z=up)
    // into Mapbox Mercator coordinates.
    const modelMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(centerMerc.x, centerMerc.y, centerMerc.z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, -scale, scale)
    );

    // Mapbox's matrix transforms Mercator → clip space.
    // camera.projectionMatrix = VP * M_model transforms local → clip space.
    const m = new THREE.Matrix4().fromArray(matrix);
    this.camera.projectionMatrix = m.multiply(modelMatrix);

    this.renderer.state.reset();
    this.renderer.render(this.scene, this.camera);
  }
}

// ============================
// MAP & UI SETUP
// ============================

let map;

function getToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken) return urlToken;

  const stored = localStorage.getItem('nycviewer_mapbox_token');
  if (stored) return stored;

  return null;
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
    center: MANHATTAN_CENTER,
    zoom: INITIAL_ZOOM,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
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
    // Add 3D buildings in white
    add3DBuildings();
    // Load subway data and add custom layer
    loadSubwayData();
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    map.flyTo({
      center: MANHATTAN_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: INITIAL_BEARING,
      duration: 1500,
    });
  });

  document.getElementById('clear-token').addEventListener('click', () => {
    localStorage.removeItem('nycviewer_mapbox_token');
    location.reload();
  });
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
        console.log('[Buildings] Hidden 2D layer:', layer.id);
      } catch (e) { /* ignore */ }
    }
  });

  // Find all fill-extrusion layers that look like buildings
  const buildingLayers = style.layers.filter((l) =>
    l.type === 'fill-extrusion' &&
    (l.id.includes('building') || l['source-layer'] === 'building')
  );

  if (buildingLayers.length > 0) {
    buildingLayers.forEach((layer) => {
      try {
        map.setPaintProperty(layer.id, 'fill-extrusion-color', '#ffffff');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty(layer.id, 'fill-extrusion-vertical-gradient', true);
        const currentHeight = map.getPaintProperty(layer.id, 'fill-extrusion-height');
        if (currentHeight) {
          map.setPaintProperty(layer.id, 'fill-extrusion-height', ['*', 1.1, currentHeight]);
        }
        console.log('[Buildings] Recolored layer:', layer.id);
      } catch (e) {
        console.warn('[Buildings] Could not modify layer', layer.id, e.message);
      }
    });
  }

  // Always add a dedicated high-quality building layer from composite source
  // (it will sit on top of any existing ones if they exist).
  let insertBefore = null;
  for (const layer of style.layers) {
    if (layer.type === 'symbol') {
      insertBefore = layer.id;
      break;
    }
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
    if (insertBefore) {
      map.addLayer(newLayer, insertBefore);
    } else {
      map.addLayer(newLayer);
    }
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

    // Add custom Three.js layer
    map.addLayer(new Subway3DLayer('subway-3d', linesData, stationsData));

    // Build legend
    buildLegend(linesData, stationsData);

    // Show UI
    loadingOverlay.classList.add('hidden');
    document.getElementById('ui-controls').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    const panel = loadingOverlay.querySelector('.panel');
    panel.innerHTML = `
      <p style="color:#EE352E;margin-bottom:12px;">Error loading subway data.</p>
      <p style="font-size:12px;color:#666;margin-bottom:12px;">${err.message}</p>
      <button onclick="location.reload()" style="padding:10px 20px;background:#111;color:white;border:none;border-radius:8px;cursor:pointer;">Retry</button>
    `;
  }
}

function buildLegend(linesData, stationsData) {
  const legend = document.getElementById('route-legend');
  const seen = new Set();

  // Collect unique routes from both lines and stations
  const features = [
    ...(linesData.features || []),
    ...(stationsData.features || []),
  ];

  features.forEach((f) => {
    const routeId = f.properties?.rt_symbol || '';
    if (!routeId || seen.has(routeId)) return;
    seen.add(routeId);

    const config = getRouteConfig(routeId);
    const badge = document.createElement('span');
    badge.className = 'route-badge';
    badge.style.backgroundColor = config.color;
    badge.textContent = routeId;
    legend.appendChild(badge);
  });
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
