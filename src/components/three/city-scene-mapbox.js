import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as THREE from 'three';
import { BOROUGH_NAMES } from '../../colors';
import {
  fetchFootprintsForRecords,
  getCachedFootprint,
} from '../../utils/footprints';
import {
  buildFootprintGeometry,
  buildGroundShadowFromRanges,
  writeBuildingColor,
  resetBuildingColor,
  HEIGHT_EXAGGERATION,
} from './footprint-mesh';

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN || '';
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Digital-twin geometry.
//
// Every visible building in the scene is a REAL extruded footprint
// pulled from the NYC Building Footprints dataset. There is no
// box-extrusion fallback: a record whose polygon can't be resolved
// (API miss, self-intersecting ring, etc.) simply doesn't draw. The
// footprint-mesh module handles simplification, minimum-size guards,
// and height exaggeration so the shapes read well at overview zoom
// without blowing up the triangle budget.

// All-5-borough cinematic default.
// Zoomed in close enough that real building footprints read as
// individual volumes; sharply pitched and rotated for an immersive
// 3D presentation.
const NYC_CENTER = [-74, 40.7];
const DEFAULT_ZOOM = 10.8;
const DEFAULT_PITCH = 45;
const DEFAULT_BEARING = -20;

// When a user clicks a building, we fly in closer and tilt the
// camera further for a dramatic "inspection" framing.
const FOCUS_ZOOM = 18.2;
const FOCUS_PITCH = 76;
const FOCUS_FLY_DURATION_MS = 1100;

// Shared NYC bbox filter.
const NYC_BOUNDS = {
  minLat: 40.49,
  maxLat: 40.92,
  minLng: -74.28,
  maxLng: -73.69,
};

// Restrict panning to NYC region.
const MAP_MAX_BOUNDS = [
  [NYC_BOUNDS.minLng, NYC_BOUNDS.minLat],
  [NYC_BOUNDS.maxLng, NYC_BOUNDS.maxLat],
];
const MAP_MIN_ZOOM = 10.2;

// Each borough preset carries a hand-tuned bearing so the flyTo
// framing feels composed — skyline in view, river where the light
// naturally falls — rather than a mechanical top-down drop.
const BOROUGH_PRESETS = {
  MN: { center: [-73.9712, 40.7831], zoom: 14.2, pitch: 70, bearing: -32 },
  BK: { center: [-73.9442, 40.6782], zoom: 14.0, pitch: 68, bearing: -58 },
  QN: { center: [-73.7949, 40.7282], zoom: 13.6, pitch: 66, bearing: -72 },
  BX: { center: [-73.8648, 40.8448], zoom: 13.8, pitch: 66, bearing: -40 },
  SI: { center: [-74.1502, 40.5795], zoom: 13.2, pitch: 62, bearing: -18 },
};

// 'reset' is a named alias for the all-borough cinematic framing.
// Exposed so callers (topbar, breadcrumb) can request the default
// without needing to know the 'all' convention.
const PRESET_DURATION_RESET_MS = 2000;
const PRESET_DURATION_BOROUGH_MS = 1600;

// LOD swap threshold. Below this zoom we show the low-detail mesh
// (aggressively simplified rings) so pan/tilt at overview stays
// fluid; above, we swap to the high-detail mesh so the user can
// inspect real footprint corners when they fly in close.
const LOD_ZOOM_THRESHOLD = 15.2;
const LOD_HIGH_SIMPLIFICATION = 1.0;
const LOD_LOW_SIMPLIFICATION = 3.5;

// Context pass (non-filtered city) rendering.
//
// When the user has a filter active we still want a sense of "this
// is Manhattan, not a blank void" — so we draw the rest of the city
// underneath as flat muted buildings. It's cached-only to stay free
// of extra network cost: we render whatever footprints the browser
// already has, and leave the rest dark.
const CONTEXT_OPACITY = 0.62;
const CONTEXT_HEIGHT_SCALE = 0.72;
const CONTEXT_MAX_RECORDS = 6000;

// Ground-shadow pass. A flat dark polygon, slightly inflated past
// each building's real footprint, lives just above the basemap.
// On the dark basemap we push both the opacity and inflation up
// noticeably — a faint soft shadow reads as real grounding against
// the low-key ground, where a subtle shadow would just disappear.
const SHADOW_OPACITY = 0.52;
const SHADOW_INFLATE_M = 4.8;
const SHADOW_Z_OFFSET_M = 0.35;

// Shader floor-band spacing. Expressed in REAL meters; converted
// to merc units at material-build time (and multiplied by our
// vertical exaggeration so bands come out at a plausible visible
// floor spacing even after the height stretch). Tuned so a mid-rise
// has roughly 10-20 visible bands — enough for the facade to read as
// "stacked floors" rather than a flat slab.
const FLOOR_BAND_SPACING_M = 3.5;
const FLOOR_BAND_STRENGTH = 0.22;
const FLOOR_BAND_WIDTH = 0.14;

// Building material transparency. A hair below 1.0 gives the fleet
// a lighter, more delicate presence against the dark basemap (the
// reference mood is "glass study model", not "plastic bricks"). We
// leave depthWrite on so the z-buffer still carries reasonable
// sort information for neighbouring towers.
const BUILDING_OPACITY = 0.94;

// Selection pulse animation. The overlay, edge wireframe, beam and
// pool materials all modulate their opacity together on this cycle.
const SELECTION_PULSE_PERIOD_MS = 1800;


// Hard cap on how many records we'll try to fetch footprints for.
// Protects the Socrata API from a huge unfiltered dataset and keeps
// cold-start from allocating an unbounded merged geometry.
const MAX_BUILDINGS = 25000;

// Warm amber hover stands out against the near-white model color and
// stays distinct from the cyan selection highlight below.
const HOVER_COLOR = '#f4a259';

// Electric cyan selection palette. Matches the "digital twin
// highlight" aesthetic of the reference: bright edge outline +
// spotlight pool on the ground.
const SELECTION_COLOR = '#2bd9ff';
const SELECTION_EDGE_COLOR = '#8af1ff';
const SELECTION_OVERLAY_OPACITY = 0.45;  // was 0.26
const SELECTION_EMISSIVE_INTENSITY = 1.4; // was 0.95
const SELECTION_EDGE_OPACITY = 1.0;       // was 0.95
const SELECTION_POOL_OPACITY = 0.35;      // was 0.18
const SELECTION_POOL_MULT = 3.5;          // was 2.6
const SELECTION_BEAM_OPACITY = 0;      // was 0.18
const SELECTION_BEAM_HEIGHT_MULT = 0;    // disc radius = this * footprint half-extent

const nycBoundaryGeoJSON = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-74.28, 40.49],
      [-74.28, 40.92],
      [-73.69, 40.92],
      [-73.69, 40.49],
      [-74.28, 40.49]
    ]]
  }
};

function isValidRecord(d) {
  const lat = +d.latitude;
  const lng = +d.longitude;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NYC_BOUNDS.minLat &&
    lat <= NYC_BOUNDS.maxLat &&
    lng >= NYC_BOUNDS.minLng &&
    lng <= NYC_BOUNDS.maxLng
  );
}

function formatNumber(n) {
  if (!Number.isFinite(+n)) return 'N/A';
  return Math.round(+n).toLocaleString();
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((m) => m?.dispose?.());
  } else {
    mesh.material?.dispose?.();
  }
  mesh.parent?.remove(mesh);
}

function disposeGroup(group) {
  if (!group || typeof group.traverse !== 'function') return;

  const disposables = [];
  group.traverse((obj) => {
    if (obj?.isMesh || obj?.isLine || obj?.isLineSegments) {
      disposables.push(obj);
    }
  });

  for (const m of disposables) {
    m.geometry?.dispose();
    if (Array.isArray(m.material)) {
      m.material.forEach((mat) => mat?.dispose?.());
    } else {
      m.material?.dispose?.();
    }
  }

  if (group.parent) {
    group.parent.remove(group);
  }
}

function CitySceneMapbox({
  data = [],
  fullData = null,
  hoveredId = null,
  onHoverChange,
  selectedId = null,
  onSelect,
  activePreset = 'all',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const layerStateRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    // Two pre-built LOD variants of the merged footprint mesh, swapped
    // by visibility based on current zoom (see LOD effect below).
    // Only ONE of them is ever `.visible = true` at a time; the other
    // stays in the scene graph so swapping is a single boolean flip.
    footprintMeshHigh: null,
    footprintMeshLow: null,
    // Per-LOD silhouette-edge LineSegments overlays. Kept in lock-step
    // with their mesh so both get shown/hidden together.
    footprintEdgesHigh: null,
    footprintEdgesLow: null,
    // Per-LOD ranges map (validIdx -> { start, count, ... }) produced
    // alongside each merged geometry. The hover / selection / picking
    // paths only touch the currently-active LOD's ranges.
    footprintRangesHigh: null,
    footprintRangesLow: null,
    // Aliases to the currently-active LOD. These are what the rest of
    // the pipeline (picking, hover, selection) actually reads.
    footprintMesh: null,
    footprintEdges: null,
    footprintRanges: null,
    // Muted grey "rest of the city" mesh, rendered only while a
    // filter is active. Not pickable and not animated — just there
    // so the filtered selection doesn't float in a blank void.
    contextMesh: null,
    contextEdges: null,
    // Flat dark polygon layer that sits a hair above the basemap,
    // slightly outside each building's footprint. Acts as a cheap
    // contact shadow so towers feel anchored to the ground.
    groundShadowMesh: null,
    // The ordered list of valid records this render is based on.
    // Picking walks this to find the nearest record to the pointer.
    valid: null,
    selectionGroup: null,
    // RequestAnimationFrame handle for the selection pulse loop.
    // Null when no building is selected; cancelled on unmount /
    // selection change.
    selectionRaf: null,
    selectionMats: null,
    mScale: 1,
    mapReady: false,
    // Reusable Three.js ray caster for entire-building picking.
    // Created once in onAdd() so the mousemove hot path doesn't
    // allocate a fresh raycaster per-frame.
    raycaster: null,
  });

  // Bumps when an async footprint fetch adds newly-resolved polygons
  // to the module-level cache. Watched by the build effect so pending
  // buildings stream in as their footprints arrive.
  const [footprintVersion, setFootprintVersion] = useState(0);

  // Which LOD is currently visible. Driven by the zoom listener; the
  // build effect always emits both LODs so swaps are free.
  const [activeLOD, setActiveLOD] = useState('high');

  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return undefined;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Dark basemap. The reference aesthetic is a "studio night
      // model": low-key ground, emissive signage, buildings read as
      // glowing glass volumes. A light style would flatten the
      // floor-band + edge highlights we author below.
      style: 'mapbox://styles/mapbox/dark-v11',
      center: NYC_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      antialias: true,
      maxBounds: MAP_MAX_BOUNDS,
      minZoom: MAP_MIN_ZOOM,
      // Raise the pitch ceiling above the default 60° so our
      // cinematic/focus framings (72° / 76°) aren't silently
      // clamped. 85° is the Mapbox-GL absolute maximum.
      maxPitch: 85,
      renderWorldCopies: false,
    });
    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      'bottom-right'
    );

    const customLayer = {
      id: 'buildings-3d',
      type: 'custom',
      renderingMode: '3d',
      onAdd(_map, gl) {
        const scene = new THREE.Scene();
        const camera = new THREE.Camera();

        // Lower ambient so buildings keep shadow contrast
        scene.add(new THREE.AmbientLight(0x2e3446, 0.18));

        // Softer hemisphere fill, still gives sky/ground mood
        const hemi = new THREE.HemisphereLight(0x6f8fc8, 0xd98a4a, 0.12);
        hemi.position.set(0, 0, 1);
        scene.add(hemi);

        // Main warm key light
        const key = new THREE.DirectionalLight(0xffd79a, 1.9);
        key.position.set(-80, -60, 90).normalize();
        scene.add(key);

        // Subtle cool rim/fill
        const fill = new THREE.DirectionalLight(0x7ea7f5, 0.28);
        fill.position.set(80, 70, 50).normalize();
        scene.add(fill);

        const renderer = new THREE.WebGLRenderer({
          canvas: _map.getCanvas(),
          context: gl,
          antialias: true,
        });
        renderer.autoClear = false;

        const st = layerStateRef.current;
        st.scene = scene;
        st.camera = camera;
        st.renderer = renderer;
        st.raycaster = new THREE.Raycaster();
        st.mapReady = true;
      },
      render(_gl, matrix) {
        const st = layerStateRef.current;
        if (!st.scene || !st.camera || !st.renderer) return;
        st.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
        st.renderer.resetState();
        st.renderer.render(st.scene, st.camera);
      },
    };

    const handleLoad = () => {
      map.setMaxBounds(MAP_MAX_BOUNDS);

      map.jumpTo({
        center: NYC_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
      });

      if (typeof map.setFog === 'function') {
        map.setFog({
          range: [1.0, 10],
          color: 'rgb(14, 20, 34)',
          'high-color': 'rgb(9, 13, 24)',
          'horizon-blend': 0.1,
          'space-color': 'rgb(4, 6, 14)',
          'star-intensity': 0.18,
        });
      }

      if (!map.getLayer(customLayer.id)) {
        map.addLayer(customLayer);
      }

      // Borough boundaries mask — darkens everything outside NYC
      fetch('/urban-dashboard/borough-geojson.json')
        .then(res => res.json())
        .then(boroughData => {
          const worldCoords = [
            [-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]
          ];
          const holes = boroughData.features.flatMap(f => {
            const geom = f.geometry;
            if (geom.type === 'Polygon') return [geom.coordinates[0]];
            if (geom.type === 'MultiPolygon') return geom.coordinates.map(p => p[0]);
            return [];
          });

          if (map.getLayer('nyc-mask-layer')) map.removeLayer('nyc-mask-layer');
          if (map.getSource('nyc-mask')) map.removeSource('nyc-mask');

          map.addSource('nyc-borough-mask', {
            type: 'geojson',
            data: {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [worldCoords, ...holes]
              }
            },
          });
          map.addLayer({
            id: 'nyc-borough-mask',
            type: 'fill',
            source: 'nyc-borough-mask',
            paint: {
              'fill-color': '#080c18',
              'fill-opacity': 0.85,
            },
          });

          map.addSource('borough-boundaries', {
            type: 'geojson',
            data: boroughData,
          });
          map.addLayer({
            id: 'borough-outlines',
            type: 'line',
            source: 'borough-boundaries',
            paint: {
              'line-color': '#3a4566',
              'line-width': 1.5,
              'line-opacity': 0.7,
            },
          });
          // Add invisible fill layer for click detection
          map.addLayer({
            id: 'borough-fill-click',
            type: 'fill',
            source: 'borough-boundaries',
            maxzoom: 13,  // only clickable when zoomed out
            paint: {
              'fill-color': '#000000',
              'fill-opacity': 0,
            },
          });

// Click handler — fly to clicked borough
map.on('click', 'borough-fill-click', (e) => {
  const feature = e.features[0];
  if (!feature) return;
  
  const boroName = feature.properties.BoroName;
  // Map borough name to your preset codes
  const nameToCode = {
    'Manhattan': 'MN',
    'Brooklyn': 'BK',
    'Queens': 'QN',
    'Bronx': 'BX',
    'Staten Island': 'SI',
  };
  const code = nameToCode[boroName];
  if (code && BOROUGH_PRESETS[code]) {
    const p = BOROUGH_PRESETS[code];
    map.flyTo({
      center: p.center,
      zoom: p.zoom,
      pitch: p.pitch,
      bearing: p.bearing,
      duration: 1600,
      essential: true,
    });
  }
});

// Change cursor on hover over borough
map.on('mouseenter', 'borough-fill-click', () => {
  map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'borough-fill-click', () => {
  map.getCanvas().style.cursor = '';
});
        });


      // Hide all labels except borough-level names
const style = map.getStyle();
style.layers.forEach(layer => {
  if (layer.type === 'symbol') {
    // Hide all text labels
    map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
});

// Add custom borough labels
const boroughLabels = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.9712, 40.7831] }, properties: { name: 'MANHATTAN' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.9442, 40.6782] }, properties: { name: 'BROOKLYN' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.7949, 40.7282] }, properties: { name: 'QUEENS' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.8648, 40.8448] }, properties: { name: 'BRONX' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.1502, 40.5795] }, properties: { name: 'STATEN ISLAND' } },
  ]
};

map.addSource('borough-labels', {
  type: 'geojson',
  data: boroughLabels,
});

map.addLayer({
  id: 'borough-label-layer',
  type: 'symbol',
  source: 'borough-labels',
  layout: {
    'text-field': ['get', 'name'],
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
    'text-size': 14,
    'text-letter-spacing': 0.15,
    'text-transform': 'uppercase',
  },
  paint: {
    'text-color': '#8899bb',
    'text-halo-color': '#0a0f1a',
    'text-halo-width': 1.5,
  },
});
      // Mapbox built-in 3D buildings as grey base layer
      const layers = map.getStyle().layers;
      const labelLayerId = layers.find(
        l => l.type === 'symbol' && l.layout?.['text-field']
      )?.id;

      map.addLayer({
        id: 'mapbox-3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#0f1320',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.25,
        },
      }, labelLayerId);
    };

    map.on('load', handleLoad);
    

    return () => {
      const st = layerStateRef.current;
      if (st.selectionRaf != null) {
        cancelAnimationFrame(st.selectionRaf);
      }
      disposeMesh(st.footprintMeshHigh);
      disposeMesh(st.footprintMeshLow);
      disposeMesh(st.footprintEdgesHigh);
      disposeMesh(st.footprintEdgesLow);
      disposeMesh(st.contextMesh);
      disposeMesh(st.contextEdges);
      disposeMesh(st.groundShadowMesh);
      disposeGroup(st.selectionGroup);
      layerStateRef.current = {
        scene: null,
        camera: null,
        renderer: null,
        footprintMeshHigh: null,
        footprintMeshLow: null,
        footprintEdgesHigh: null,
        footprintEdgesLow: null,
        footprintRangesHigh: null,
        footprintRangesLow: null,
        footprintMesh: null,
        footprintEdges: null,
        footprintRanges: null,
        contextMesh: null,
        contextEdges: null,
        groundShadowMesh: null,
        valid: null,
        selectionGroup: null,
        selectionRaf: null,
        selectionMats: null,
        mScale: 1,
        mapReady: false,
        raycaster: null,
      };
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Footprint fetch effect.
  //
  // Fires whenever `data` changes. Resolves each record (up to
  // MAX_BUILDINGS) against the NYC Open Data footprints API. Results
  // land in the module-level cache inside utils/footprints.js; we
  // bump `footprintVersion` progressively so the build effect re-runs
  // and the scene fills in with real polygons in visible waves as
  // batches complete.
  useEffect(() => {
    if (!data || data.length === 0) return undefined;

    let valid = data.filter(isValidRecord);
    if (valid.length > MAX_BUILDINGS) valid = valid.slice(0, MAX_BUILDINGS);
    if (valid.length === 0) return undefined;

    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    let cancelled = false;

    // Rebuild the scene at most every N ms while batches trickle in.
    // Tuned so the user sees buildings appear in a handful of visible
    // waves without thrashing the GPU on every single batch.
    const PROGRESSIVE_REBUILD_MS = 1500;
    let lastRebuild = 0;

    const scheduleRebuild = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastRebuild < PROGRESSIVE_REBUILD_MS) return;
      lastRebuild = now;
      setFootprintVersion((v) => v + 1);
    };

    const started = Date.now();
    fetchFootprintsForRecords(valid, {
      signal: controller?.signal,
      onProgress: scheduleRebuild,
    })
      .then((resolved) => {
        if (cancelled) return;
        // Final rebuild is unconditional -- ensures the last batch's
        // results land even if the throttle window skipped them.
        setFootprintVersion((v) => v + 1);
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        // Deliberate info-level log: the fetch is a noticeable piece
        // of cold-start work and it's useful to see "X of Y
        // buildings resolved in Zs" when verifying the pipeline.
        // eslint-disable-next-line no-console
        console.info(
          `[digital-twin] ${resolved.size}/${valid.length} building footprints ` +
            `resolved in ${elapsed}s; unresolved records are not rendered.`
        );
      })
      .catch(() => {
        // Network failures are non-fatal. Unresolved records simply
        // stay hidden until a retry (e.g. after a filter change).
      });

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    const st = layerStateRef.current;
    if (!map) return undefined;

    let cancelled = false;

    // Factory for the foreground building material. Called twice
    // (once per LOD) so each mesh carries its own MeshStandardMaterial
    // instance and we don't cross the streams if one gets disposed.
    //
    // The material hooks into Three.js's `onBeforeCompile` so we can
    // inject a floor-band modulation in the fragment shader. This is
    // what breaks the "just a block" look — without these bands a
    // 100m tower renders as a single flat volume; with them the
    // facade reads as "stacked floors", even at zoom-out where no
    // single floor is individually legible. No extra geometry cost
    // (the pattern is computed per-fragment from world Z).
    // `scale` is the merc-per-meter ratio from the current build
    // pass. It can't be closed over at module load — the seed
    // coordinate, and therefore the scale, is only known once we
    // have data in hand — so we thread it through as an argument.
    const makeBuildingMaterial = (scale) => {
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.68,
        metalness: 0.12,
        envMapIntensity: 0.45,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: BUILDING_OPACITY,
        // depthWrite stays on so transparent buildings still occlude
        // each other plausibly. At opacity ≈ 0.94 the worst case is
        // a faint ring on a far building seen through a nearer one,
        // which we accept for the overall glassier tone.
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      // Convert real-world floor spacing to the extruded mesh's
      // merc Z units (the geometry already carries HEIGHT_EXAGGERATION
      // stretch, so we multiply through to keep bands spaced at a
      // "visibly one floor" interval no matter the exaggeration).
      const floorSpacingMerc =
        FLOOR_BAND_SPACING_M * HEIGHT_EXAGGERATION * scale;

      m.onBeforeCompile = (shader) => {
        shader.uniforms.uFloorSpacing = { value: floorSpacingMerc };
        shader.uniforms.uBandStrength = { value: FLOOR_BAND_STRENGTH };
        shader.uniforms.uBandWidth = { value: FLOOR_BAND_WIDTH };

        // Vertex: carry world-Z through to the fragment stage. Our
        // mesh sits at identity (no modelMatrix transform: the
        // per-building anchor is baked into the position attribute),
        // so `position.z` is already the world-space height.
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
varying float vBuildingZ;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vBuildingZ = position.z;`
          );

        // Fragment: darken a thin band at each floor boundary. The
        // `smoothstep` edges keep the transition soft so the pattern
        // reads as subtle floor lines rather than a barcode. Hook
        // just before `<opaque_fragment>` (which writes gl_FragColor)
        // so we mutate `outgoingLight` right before it's output.
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
varying float vBuildingZ;
uniform float uFloorSpacing;
uniform float uBandStrength;
uniform float uBandWidth;`
          )
          .replace(
            '#include <opaque_fragment>',
            `
float bandPhase = fract(vBuildingZ / uFloorSpacing);
float bandDist = min(bandPhase, 1.0 - bandPhase);
float bandFactor = smoothstep(0.0, uBandWidth, bandDist);
outgoingLight *= mix(1.0 - uBandStrength, 1.0, bandFactor);
#include <opaque_fragment>`
          );
      };
      return m;
    };

    const makeEdgeOverlay = (geometry, { opacity = 0.55, angle = 25 } = {}) => {
      const edgesGeom = new THREE.EdgesGeometry(geometry, angle);
      const edgesMat = new THREE.LineBasicMaterial({
        // Cool mid-tone so edges pop against the dark basemap but
        // don't bleach out the facade detail underneath.
        color: 0x7d8aa4,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const line = new THREE.LineSegments(edgesGeom, edgesMat);
      line.frustumCulled = false;
      line.renderOrder = 1.5;
      line.raycast = () => null;
      return line;
    };

    const build = () => {
      if (cancelled || !st.scene) return;

      // Tear down every mesh this build owns. Selection, hover, and
      // LOD aliases all rebuild on top of what lands below.
      disposeMesh(st.footprintMeshHigh);
      disposeMesh(st.footprintMeshLow);
      disposeMesh(st.footprintEdgesHigh);
      disposeMesh(st.footprintEdgesLow);
      disposeMesh(st.contextMesh);
      disposeMesh(st.contextEdges);
      disposeMesh(st.groundShadowMesh);
      disposeGroup(st.selectionGroup);
      st.footprintMeshHigh = null;
      st.footprintMeshLow = null;
      st.footprintEdgesHigh = null;
      st.footprintEdgesLow = null;
      st.footprintRangesHigh = null;
      st.footprintRangesLow = null;
      st.footprintMesh = null;
      st.footprintEdges = null;
      st.footprintRanges = null;
      st.contextMesh = null;
      st.contextEdges = null;
      st.groundShadowMesh = null;
      st.selectionGroup = null;
      st.valid = null;

      const referencePool =
        (data && data.length > 0 && data) ||
        (fullData && fullData.length > 0 && fullData) ||
        null;

      if (!referencePool) {
        map.triggerRepaint();
        return;
      }

      const seed = referencePool.find(isValidRecord);
      if (!seed) {
        map.triggerRepaint();
        return;
      }

      const seedMerc = mapboxgl.MercatorCoordinate.fromLngLat(
        [+seed.longitude, +seed.latitude],
        0
      );
      const mScale = seedMerc.meterInMercatorCoordinateUnits();
      st.mScale = mScale;

      if (!data || data.length === 0) {
        map.triggerRepaint();
        return;
      }

      let valid = data.filter(isValidRecord);
      if (valid.length > MAX_BUILDINGS) valid = valid.slice(0, MAX_BUILDINGS);
      if (valid.length === 0) {
        map.triggerRepaint();
        return;
      }

      // Collect every record with a resolved footprint in the cache.
      // On cold start this is usually empty — the fetch effect will
      // populate it and bump `footprintVersion`, re-running this
      // build with real polygons in visible waves.
      const footprintsForBuild = new Map();
      for (let i = 0; i < valid.length; i++) {
        const fp = getCachedFootprint(valid[i]);
        if (fp) footprintsForBuild.set(i, fp);
      }

      const wantLOD = map.getZoom() >= LOD_ZOOM_THRESHOLD ? 'high' : 'low';

      if (footprintsForBuild.size > 0) {
        // ---- High-detail LOD (close zoom) ----------------------------
        const builtHigh = buildFootprintGeometry(valid, footprintsForBuild, {
          mScale,
          simplification: LOD_HIGH_SIMPLIFICATION,
        });
        if (builtHigh) {
          const meshHigh = new THREE.Mesh(
            builtHigh.geometry,
            makeBuildingMaterial(mScale)
          );
          meshHigh.frustumCulled = false;
          meshHigh.renderOrder = 1;
          meshHigh.visible = wantLOD === 'high';
          st.scene.add(meshHigh);
          st.footprintMeshHigh = meshHigh;
          st.footprintRangesHigh = builtHigh.ranges;

          const edgesHigh = makeEdgeOverlay(builtHigh.geometry, {
            opacity: 0.55,
            angle: 25,
          });
          edgesHigh.visible = wantLOD === 'high';
          st.scene.add(edgesHigh);
          st.footprintEdgesHigh = edgesHigh;
        }

        // ---- Low-detail LOD (overview zoom) --------------------------
        // Aggressive RDP tolerance drops triangle count by ~3x so
        // pan/tilt over 20k buildings stays fluid when the camera
        // pulls back. The coarser silhouettes are hidden by the zoom
        // threshold — we only ever show this LOD far enough out that
        // corner rounding is invisible anyway.
        const builtLow = buildFootprintGeometry(valid, footprintsForBuild, {
          mScale,
          simplification: LOD_LOW_SIMPLIFICATION,
        });
        if (builtLow) {
          const meshLow = new THREE.Mesh(
            builtLow.geometry,
            makeBuildingMaterial(mScale)
          );
          meshLow.frustumCulled = false;
          meshLow.renderOrder = 1;
          meshLow.visible = wantLOD === 'low';
          st.scene.add(meshLow);
          st.footprintMeshLow = meshLow;
          st.footprintRangesLow = builtLow.ranges;

          // Wider edge-angle threshold for the coarser silhouette
          // so we don't draw spurious outlines on near-coplanar
          // triangles produced by the coarser ear-clipper.
          const edgesLow = makeEdgeOverlay(builtLow.geometry, {
            opacity: 0.48,
            angle: 30,
          });
          edgesLow.visible = wantLOD === 'low';
          st.scene.add(edgesLow);
          st.footprintEdgesLow = edgesLow;
        }

        // Alias currently-active LOD for downstream readers.
        st.footprintMesh =
          wantLOD === 'high' ? st.footprintMeshHigh : st.footprintMeshLow;
        st.footprintRanges =
          wantLOD === 'high' ? st.footprintRangesHigh : st.footprintRangesLow;
        st.footprintEdges =
          wantLOD === 'high' ? st.footprintEdgesHigh : st.footprintEdgesLow;

        // ---- Ground-shadow pass --------------------------------------
        //
        // Built from the high-LOD ranges because those carry the most
        // faithful outer rings. The shadow is flat, so any extra
        // vertices cost nothing material to the fragment stage.
        const shadow = buildGroundShadowFromRanges(builtHigh?.ranges, {
          mScale,
          inflateM: SHADOW_INFLATE_M,
          zOffset: SHADOW_Z_OFFSET_M * mScale,
        });
        if (shadow) {
          const shadowMesh = new THREE.Mesh(
            shadow.geometry,
            new THREE.MeshBasicMaterial({
              color: shadow.color,
              transparent: true,
              opacity: SHADOW_OPACITY,
              depthWrite: false,
            })
          );
          shadowMesh.frustumCulled = false;
          shadowMesh.renderOrder = 0;
          shadowMesh.raycast = () => null;
          st.scene.add(shadowMesh);
          st.groundShadowMesh = shadowMesh;
        }
      }

      // ---- Context pass (muted "rest of city") -----------------------
      //
      // Only when a filter is active. We take the difference between
      // fullData and data, drop anything we don't already have a
      // cached footprint for, and build a single flat grey mesh from
      // whatever remains. No network I/O — this is pure "use what's
      // already loaded" so filter switches don't stall on a fetch.
      if (
        fullData &&
        Array.isArray(fullData) &&
        data &&
        fullData.length > data.length
      ) {
        const dataSet = new Set(data);
        const ctxRecords = [];
        for (let i = 0; i < fullData.length; i++) {
          const r = fullData[i];
          if (dataSet.has(r)) continue;
          if (!isValidRecord(r)) continue;
          if (!getCachedFootprint(r)) continue;
          ctxRecords.push(r);
          if (ctxRecords.length >= CONTEXT_MAX_RECORDS) break;
        }

        if (ctxRecords.length > 0) {
          const ctxFootprints = new Map();
          for (let i = 0; i < ctxRecords.length; i++) {
            const fp = getCachedFootprint(ctxRecords[i]);
            if (fp) ctxFootprints.set(i, fp);
          }
          if (ctxFootprints.size > 0) {
            const ctxBuilt = buildFootprintGeometry(
              ctxRecords,
              ctxFootprints,
              {
                mScale,
                // Coarser than low-LOD — context is never
                // inspected up close, so aggressive simplification
                // is free aesthetically and wins back triangle budget.
                simplification: LOD_LOW_SIMPLIFICATION * 1.2,
                contextMode: true,
                heightScale: CONTEXT_HEIGHT_SCALE,
              }
            );
            if (ctxBuilt) {
              const ctxMat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.88,
                metalness: 0.02,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: CONTEXT_OPACITY,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: 2,
                polygonOffsetUnits: 2,
              });
              const ctxMesh = new THREE.Mesh(ctxBuilt.geometry, ctxMat);
              ctxMesh.frustumCulled = false;
              ctxMesh.renderOrder = 0.5;
              ctxMesh.raycast = () => null;
              st.scene.add(ctxMesh);
              st.contextMesh = ctxMesh;
            }
          }
        }
      }

      st.valid = valid;

      // Push the current-zoom LOD choice back into React state so the
      // dependent hover/select effects re-run against the correct
      // ranges table.
      setActiveLOD((prev) => (prev === wantLOD ? prev : wantLOD));

      map.triggerRepaint();
    };

    if (st.mapReady) {
      build();
    } else {
      map.once('load', build);
    }

    return () => {
      cancelled = true;
    };
  }, [data, fullData, footprintVersion]);

  // Zoom-driven LOD swap.
  //
  // We listen to `zoom` (not just `zoomend`) so the swap happens as
  // soon as the user crosses the threshold, keeping pan/tilt fluid.
  // A cheap `st.activeLOD` guard avoids thrashing the scene graph on
  // every frame of a continuous zoom gesture.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const onZoom = () => {
      const st = layerStateRef.current;
      const z = map.getZoom();
      const want = z >= LOD_ZOOM_THRESHOLD ? 'high' : 'low';
      const haveHigh = !!st.footprintMeshHigh;
      const haveLow = !!st.footprintMeshLow;
      // If only one LOD has been built (e.g. low-poly fallback while
      // the other is still streaming in), don't try to swap away
      // from the one we actually have.
      if (want === 'high' && !haveHigh && haveLow) return;
      if (want === 'low' && !haveLow && haveHigh) return;

      setActiveLOD((prev) => (prev === want ? prev : want));
    };

    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, []);

  // Apply activeLOD changes to the scene graph. Kept in its own
  // effect so the state setter above doesn't double-fire during
  // builds (which also call setActiveLOD).
  useEffect(() => {
    const map = mapRef.current;
    const st = layerStateRef.current;
    if (!map) return;

    const toHigh = activeLOD === 'high';
    if (st.footprintMeshHigh) st.footprintMeshHigh.visible = toHigh;
    if (st.footprintEdgesHigh) st.footprintEdgesHigh.visible = toHigh;
    if (st.footprintMeshLow) st.footprintMeshLow.visible = !toHigh;
    if (st.footprintEdgesLow) st.footprintEdgesLow.visible = !toHigh;

    st.footprintMesh = toHigh ? st.footprintMeshHigh : st.footprintMeshLow;
    st.footprintRanges = toHigh
      ? st.footprintRangesHigh
      : st.footprintRangesLow;
    st.footprintEdges = toHigh ? st.footprintEdgesHigh : st.footprintEdgesLow;

    map.triggerRepaint();
  }, [activeLOD]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // 'reset' is an alias for 'all'; both frame the full-borough
      // cinematic view.
      const preset = activePreset === 'reset' ? 'all' : activePreset;

      if (preset === 'all' || !BOROUGH_PRESETS[preset]) {
        map.flyTo({
          center: NYC_CENTER,
          zoom: DEFAULT_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: PRESET_DURATION_RESET_MS,
          curve: 1.6,
          essential: true,
        });
      } else {
        const p = BOROUGH_PRESETS[preset];
        map.flyTo({
          center: p.center,
          zoom: p.zoom,
          pitch: p.pitch,
          bearing: p.bearing,
          duration: PRESET_DURATION_BOROUGH_MS,
          curve: 1.55,
          essential: true,
        });
      }
    };

    if (!mapRef.current.__presetInit) {
      mapRef.current.__presetInit = true;
      return;
    }
    apply();
  }, [activePreset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    // Scratch vectors for the ray-from-screen math below. Declared
    // once at effect-setup time so mousemove doesn't allocate.
    const ndcNear = new THREE.Vector3();
    const ndcFar = new THREE.Vector3();
    const invProj = new THREE.Matrix4();

    // Raycast-based picking.
    //
    // Any triangle of any building's extruded mesh is a valid hit —
    // so the user can click a roof, a facade, or the base of a tower
    // and we'll still resolve it to the correct building. This is a
    // meaningful upgrade from the old "click within N px of the
    // lat/lng point" path: tall towers seen from a pitched camera
    // occupy a lot of screen area that had no idea it was clickable.
    //
    // Implementation:
    //   1. Convert the pointer to NDC (-1..1 on x/y).
    //   2. Invert the current projection*view matrix (the scene
    //      camera stores the combined matrix Mapbox hands it every
    //      frame; there is no separate view transform).
    //   3. Unproject two depths (near/far) to build a world-space
    //      ray; feed it directly to a re-used Raycaster.
    //   4. Intersect the CURRENTLY-VISIBLE LOD mesh. Map the hit
    //      face back to a record via `ranges` (which stores each
    //      building's vertex slice in the merged buffer).
    const pick = (point) => {
      const st = layerStateRef.current;
      const mesh = st.footprintMesh;
      const ranges = st.footprintRanges;
      const valid = st.valid;
      const camera = st.camera;
      const raycaster = st.raycaster;
      if (!mesh || !ranges || !valid || !camera || !raycaster) return -1;

      const canvas = map.getCanvas();
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      if (!w || !h) return -1;

      const x = (point.x / w) * 2 - 1;
      const y = -(point.y / h) * 2 + 1;

      invProj.copy(camera.projectionMatrix).invert();
      ndcNear.set(x, y, -1).applyMatrix4(invProj);
      ndcFar.set(x, y, 1).applyMatrix4(invProj);
      const dir = ndcFar.clone().sub(ndcNear).normalize();

      raycaster.ray.origin.copy(ndcNear);
      raycaster.ray.direction.copy(dir);
      raycaster.near = 0;
      raycaster.far = Infinity;

      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0) return -1;
      const hit = hits[0];

      // Merged geometry may or may not be indexed depending on how
      // BufferGeometryUtils merged the per-building slices. Handle
      // both cases: indexed -> lookup through the index buffer;
      // non-indexed -> triangle index directly.
      const geom = mesh.geometry;
      let vertIdx;
      if (geom.index) {
        vertIdx = geom.index.array[hit.faceIndex * 3];
      } else {
        vertIdx = hit.faceIndex * 3;
      }

      // Linear scan of ranges — ~O(n buildings). For our caps
      // (<=20k entries) this is still sub-millisecond in practice
      // and keeps the data structure simple. If the render budget
      // ever cares we can swap this for a sorted/binary-search
      // table keyed on `start`.
      for (const [validIdx, r] of ranges.entries()) {
        if (vertIdx >= r.start && vertIdx < r.start + r.count) {
          return validIdx;
        }
      }
      return -1;
    };

    const handleMove = (e) => {
      const id = pick(e.point);
      if (onHoverChange) onHoverChange(id >= 0 ? id : null);

      if (id >= 0) {
        setTooltip({
          x: e.point.x,
          y: e.point.y,
          record: layerStateRef.current.valid[id],
        });
        map.getCanvas().style.cursor = 'pointer';
      } else {
        setTooltip(null);
        map.getCanvas().style.cursor = '';
      }
    };

    const handleLeave = () => {
      if (onHoverChange) onHoverChange(null);
      setTooltip(null);
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e) => {
      const id = pick(e.point);
      if (id < 0) return;
      const record = layerStateRef.current.valid[id];
      if (!record) return;

      // Fly the camera in to frame the clicked building. We keep the
      // current bearing so the user's spatial orientation isn't
      // disrupted — only zoom + pitch + center change.
      map.flyTo({
        center: [+record.longitude, +record.latitude],
        zoom: FOCUS_ZOOM,
        pitch: FOCUS_PITCH,
        bearing: map.getBearing(),
        duration: FOCUS_FLY_DURATION_MS,
        essential: true,
      });

      if (onSelect) onSelect(record, id);
    };

    map.on('mousemove', handleMove);
    map.on('click', handleClick);
    const canvas = map.getCanvas();
    canvas.addEventListener('mouseleave', handleLeave);

    return () => {
      map.off('mousemove', handleMove);
      map.off('click', handleClick);
      canvas.removeEventListener('mouseleave', handleLeave);
    };
  }, [onHoverChange, onSelect]);

  // Tracks which validIdx is currently painted with HOVER_COLOR on
  // each LOD mesh. Carried across re-renders via a ref so that LOD
  // swaps can wipe stale highlights off the mesh that's about to
  // go behind the scenes.
  const hoverStateRef = useRef({ high: null, low: null });
  useEffect(() => {
    const map = mapRef.current;
    const st = layerStateRef.current;
    const valid = st.valid;
    if (!valid) return;

    const color = new THREE.Color();
    let dirtyHigh = false;
    let dirtyLow = false;

    // Reset any previously-hovered building on BOTH LOD meshes.
    // The hidden mesh needs this too or it'll be stuck with stale
    // amber the next time the user crosses the LOD threshold.
    const lods = [
      {
        key: 'high',
        mesh: st.footprintMeshHigh,
        ranges: st.footprintRangesHigh,
      },
      {
        key: 'low',
        mesh: st.footprintMeshLow,
        ranges: st.footprintRangesLow,
      },
    ];

    for (const lod of lods) {
      const prev = hoverStateRef.current[lod.key];
      if (prev == null || !lod.mesh || !lod.ranges) continue;
      const r = lod.ranges.get(prev);
      if (r) {
        resetBuildingColor(lod.mesh.geometry, r);
        if (lod.key === 'high') dirtyHigh = true;
        else dirtyLow = true;
      }
      hoverStateRef.current[lod.key] = null;
    }

    // Write the hover tint to the currently-active mesh only.
    if (hoveredId != null) {
      const mesh = st.footprintMesh;
      const ranges = st.footprintRanges;
      if (mesh && ranges) {
        const r = ranges.get(hoveredId);
        if (r) {
          color.set(HOVER_COLOR);
          writeBuildingColor(mesh.geometry, r, [color.r, color.g, color.b]);
          hoverStateRef.current[activeLOD] = hoveredId;
          if (activeLOD === 'high') dirtyHigh = true;
          else dirtyLow = true;
        }
      }
    }

    if (dirtyHigh && st.footprintMeshHigh) {
      const attr = st.footprintMeshHigh.geometry.attributes.color;
      if (attr) attr.needsUpdate = true;
    }
    if (dirtyLow && st.footprintMeshLow) {
      const attr = st.footprintMeshLow.geometry.attributes.color;
      if (attr) attr.needsUpdate = true;
    }
    if (dirtyHigh || dirtyLow) map?.triggerRepaint();
  }, [hoveredId, activeLOD]);

  useEffect(() => {
    const map = mapRef.current;
    const st = layerStateRef.current;
    if (!st.scene) return undefined;

    // Stop any previous pulse loop before we tear down the group
    // it was modulating. Forgetting this would leak a running RAF
    // that keeps calling triggerRepaint after the materials are gone.
    if (st.selectionRaf != null) {
      cancelAnimationFrame(st.selectionRaf);
      st.selectionRaf = null;
    }
    st.selectionMats = null;

    if (st.selectionGroup) {
      disposeGroup(st.selectionGroup);
      st.selectionGroup = null;
    }

    if (selectedId == null || !st.valid || !st.footprintRanges) {
      map?.triggerRepaint();
      return undefined;
    }

    const range = st.footprintRanges.get(selectedId);
    // Nothing to outline if the building's footprint hasn't resolved.
    if (!range) {
      map?.triggerRepaint();
      return undefined;
    }

    const heightMerc = range.heightMerc;
    const outerRing = range.outerRing;
    const [cx, cy] = range.center;
    const [extW, extH] = range.extents;
    const halfExtent = Math.max(extW, extH) * 0.5;

    const group = new THREE.Group();
    group.renderOrder = 2;

    // Materials the pulse loop will modulate. We hang on to the ones
    // we care about via `st.selectionMats` so the RAF tick can read
    // their base opacities without dipping into `group.children`.
    const mats = {
      base: {
        overlay: SELECTION_OVERLAY_OPACITY,
        edges: SELECTION_EDGE_OPACITY,
        pool: SELECTION_POOL_OPACITY,
        beam: SELECTION_BEAM_OPACITY,
      },
      overlay: null,
      edges: null,
      pool: null,
      beam: null,
    };

    // ---- Translucent fill overlay ---------------------------------
    //
    // Rebuild a single ExtrudeGeometry from the cached footprint so
    // the overlay hugs the real polygon. Positioned in absolute
    // mercator so it aligns pixel-perfect with the merged mesh
    // underneath.
    const record = st.valid[selectedId];
    const cachedFp = getCachedFootprint(record);
    let overlayGeom = null;
    if (cachedFp?.geometry && outerRing.length >= 3) {
      const shape = new THREE.Shape(outerRing);
      try {
        overlayGeom = new THREE.ExtrudeGeometry(shape, {
          depth: heightMerc,
          bevelEnabled: false,
          steps: 1,
          curveSegments: 1,
        });
      } catch {
        overlayGeom = null;
      }
    }

    if (overlayGeom) {
      const overlayMat = new THREE.MeshStandardMaterial({
        color: SELECTION_COLOR,
        emissive: SELECTION_COLOR,
        emissiveIntensity: SELECTION_EMISSIVE_INTENSITY,
        transparent: true,
        opacity: SELECTION_OVERLAY_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(overlayGeom, overlayMat);
      overlay.renderOrder = 2;
      overlay.raycast = () => null;
      group.add(overlay);
      mats.overlay = overlayMat;

      const edgeGeom = new THREE.EdgesGeometry(overlayGeom, 1);
      const edgesMat = new THREE.LineBasicMaterial({
        color: SELECTION_EDGE_COLOR,
        transparent: true,
        opacity: SELECTION_EDGE_OPACITY,
        depthTest: false,
      });
      const edges = new THREE.LineSegments(edgeGeom, edgesMat);
      edges.renderOrder = 4;
      edges.raycast = () => null;
      group.add(edges);
      mats.edges = edgesMat;
    }

    // ---- Vertical "scan beam" -------------------------------------
    //
    // Thin translucent cylinder shooting up from the roof. Makes the
    // selected tower findable even when the camera is framed unfav-
    // orably or the building is small. Rendered with depthWrite off
    // and no raycast so it never blocks picking of whatever's behind.
    {
      const beamHeight = Math.max(
        heightMerc * SELECTION_BEAM_HEIGHT_MULT,
        halfExtent * 4
      );
      const beamRadiusBase = Math.max(halfExtent * 0.28, 1e-6);
      const beamRadiusTop = Math.max(halfExtent * 0.08, 1e-6);
      const beamGeom = new THREE.CylinderGeometry(
        beamRadiusTop,
        beamRadiusBase,
        beamHeight,
        24,
        1,
        true
      );
      // CylinderGeometry is oriented along +Y; rotate so its axis is
      // +Z (our "up" in Mercator scene space).
      beamGeom.rotateX(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({
        color: SELECTION_COLOR,
        transparent: true,
        opacity: SELECTION_BEAM_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeom, beamMat);
      // Place the beam so its base sits flush with the roof and it
      // extends upward from there.
      beam.position.set(cx, cy, heightMerc + beamHeight / 2);
      beam.renderOrder = 3;
      beam.raycast = () => null;
      group.add(beam);
      mats.beam = beamMat;
    }

    // ---- Ground pool spotlight ------------------------------------
    //
    // A large soft disc of translucent cyan sits just above the
    // basemap at the footprint's bbox center, giving the selected
    // building the "spotlit on the model table" feel seen in the
    // reference.
    {
      const poolMat = new THREE.MeshBasicMaterial({
        color: SELECTION_COLOR,
        transparent: true,
        opacity: SELECTION_POOL_OPACITY,
        depthWrite: false,
      });
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 48), poolMat);
      const poolRadius = Math.max(halfExtent * SELECTION_POOL_MULT, 1e-6);
      pool.position.set(cx, cy, heightMerc * 0.005);
      pool.scale.set(poolRadius, poolRadius, 1);
      pool.renderOrder = 1;
      pool.raycast = () => null;
      group.add(pool);
      mats.pool = poolMat;
    }

    st.scene.add(group);
    st.selectionGroup = group;
    st.selectionMats = mats;

    // ---- Pulse animation -----------------------------------------
    //
    // All selection materials modulate together on a shared sine so
    // the highlight reads as one breathing pulse rather than a pile
    // of independently animated objects. Only runs while a building
    // is selected — no idle render cost otherwise.
    const start = performance.now();
    const tick = () => {
      const now = performance.now();
      const phase =
        ((now - start) % SELECTION_PULSE_PERIOD_MS) / SELECTION_PULSE_PERIOD_MS;
      // 0..1 ease: sine rising and falling symmetrically.
      const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);

      const m = st.selectionMats;
      if (!m) return;
      if (m.overlay) m.overlay.opacity = m.base.overlay * (0.75 + 0.6 * pulse);
      if (m.edges) m.edges.opacity = m.base.edges * (0.75 + 0.35 * pulse);
      if (m.pool) m.pool.opacity = m.base.pool * (0.7 + 0.75 * pulse);
      if (m.beam) m.beam.opacity = m.base.beam * (0.55 + 0.85 * pulse);

      map?.triggerRepaint();
      st.selectionRaf = requestAnimationFrame(tick);
    };
    st.selectionRaf = requestAnimationFrame(tick);

    map?.triggerRepaint();
    return () => {
      if (st.selectionRaf != null) {
        cancelAnimationFrame(st.selectionRaf);
        st.selectionRaf = null;
      }
    };
  }, [selectedId, activeLOD]);

  if (!MAPBOX_TOKEN) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d1220',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 440,
            background: '#151b2e',
            border: '1px solid #222940',
            borderRadius: 12,
            padding: '20px 24px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: '#d7dbe8',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            Mapbox token missing
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: '#8c93ab' }}>
            Set <code>REACT_APP_MAPBOX_TOKEN</code> in a <code>.env</code> file
            at the project root and restart <code>npm start</code> to enable
            the 3D map view.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {tooltip && tooltip.record && (
        <div
          className="d3-tooltip"
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, calc(-100% - 14px))',
            pointerEvents: 'none',
            opacity: 1,
            whiteSpace: 'nowrap',
            zIndex: 6,
          }}
        >
          <strong>{tooltip.record.address || 'Unknown address'}</strong>
          <div className="tt-row">
            <span className="tt-label">Borough</span>
            <span className="tt-value">
              {BOROUGH_NAMES[tooltip.record.borough] ??
                tooltip.record.borough ??
                'N/A'}
            </span>
          </div>
          <div className="tt-row">
            <span className="tt-label">Floors</span>
            <span className="tt-value">
              {formatNumber(tooltip.record.numfloors)}
            </span>
          </div>
          <div className="tt-row">
            <span className="tt-label">Year</span>
            <span className="tt-value">
              {Number.isFinite(+tooltip.record.yearbuilt) &&
              +tooltip.record.yearbuilt > 0
                ? tooltip.record.yearbuilt
                : 'N/A'}
            </span>
          </div>
          <div className="tt-row">
            <span className="tt-label">Area</span>
            <span className="tt-value">
              {Number.isFinite(+tooltip.record.bldgarea)
                ? `${formatNumber(tooltip.record.bldgarea)} sqft`
                : 'N/A'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CitySceneMapbox;
