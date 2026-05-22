// Foundation 3D scene for the city view.
// Sets up the React Three Fiber Canvas, lights, ground, building layer,
// borough labels, and camera rig. Now also computes per-borough camera
// presets from the data so the rig can fly to "All" or any borough.
//
// Visual polish (no extra deps):
//   - ACES filmic tone mapping for nicer color rolloff
//   - Hemisphere light for softer ambient gradient
//   - Subtle linear fog for atmospheric depth on far buildings
//
// Real post-processing (bloom, SSAO, FXAA) would need
// `@react-three/postprocessing` -- intentionally not added here.

import { useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import CameraRig from './camera-rig';
import GroundPlane from './ground-plane';
import BuildingLayer from './building-layer';
import BoroughLabels3D from './borough-labels3d';
import BoroughBoundaries from './borough-boundaries';
import BoroughGroundTints from './borough-ground-tints';
import { createNYCProjector } from '../../utils/projection';

// Same NYC bounds used everywhere else in the 3D layer.
const NYC_BOUNDS = {
  minLat: 40.4,
  maxLat: 40.95,
  minLng: -74.3,
  maxLng: -73.65,
};

const WORLD_SIZE = 300;

// Default ("All boroughs") framing.
// Lower altitude + tighter horizontal offset gives the more cinematic
// "architectural 3/4" angle (~24deg from horizontal) rather than the
// previous near-overhead plan view.
const DEFAULT_PRESET = {
  target: [0, 0, 0],
  position: [90, 70, 130],
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

// Compute the world-space axis-aligned bbox of the filtered, valid
// buildings using the SHARED stable projector, then derive a camera
// target (bbox center) + position (offset scaled to bbox span). With
// few/clustered buildings the camera flies in close; with the full
// dataset the result collapses back toward DEFAULT_PRESET.
function computeFitPreset(data, project) {
  if (!data || data.length === 0) return DEFAULT_PRESET;
  const valid = data.filter(isValidRecord);
  if (valid.length === 0) return DEFAULT_PRESET;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const d of valid) {
    const { x, z } = project(+d.longitude, +d.latitude);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const sx = maxX - minX;
  const sz = maxZ - minZ;

  // Tighter padding (was 1.25) pulls the camera in so the filtered
  // cluster fills more of the frame. The min span floor (was 12) is
  // also tightened so a tiny filter produces a proper close-up rather
  // than an over-padded "empty neighborhood" shot.
  const span = Math.max(sx, sz, 9) * 1.1;
  // Distance scale relative to the default full-city framing.
  // Lower floor (was 0.18) allows a meaningfully closer zoom on tight
  // filters; upper clamp unchanged.
  const k = Math.min(Math.max(span / WORLD_SIZE, 0.12), 1.3);

  return {
    target: [cx, 0, cz],
    position: [
      cx + DEFAULT_PRESET.position[0] * k,
      // Floor lowered (35 -> 26) so tight filters get a flatter, more
      // architectural angle instead of a near-top-down view. Still
      // stays clear of rooftop level (focus buildings cap at ~160
      // world units and we never drop below 26).
      Math.max(26, DEFAULT_PRESET.position[1] * k),
      cz + DEFAULT_PRESET.position[2] * k,
    ],
  };
}

function computePresets(data, project) {
  const presets = { all: DEFAULT_PRESET };
  if (!data || data.length === 0) return presets;

  const valid = data.filter(isValidRecord);
  if (valid.length === 0) return presets;

  const sums = new Map();
  for (const d of valid) {
    if (!d.borough) continue;
    const acc = sums.get(d.borough) ?? { lng: 0, lat: 0, n: 0 };
    acc.lng += +d.longitude;
    acc.lat += +d.latitude;
    acc.n += 1;
    sums.set(d.borough, acc);
  }

  for (const [borough, { lng, lat, n }] of sums) {
    if (n === 0) continue;
    const { x, z } = project(lng / n, lat / n);
    presets[borough] = {
      target: [x, 0, z],
      // Camera offset chosen for a comfortable 3/4 overview of one borough.
      position: [x + 55, 70, z + 80],
    };
  }
  return presets;
}

function CityScene3D({
  data = [],
  fullData = null,
  hoveredId = null,
  onHoverChange,
  selectedId = null,
  onSelect,
  activePreset = 'all',
}) {
  // One stable projector shared by preset + bbox-fit math. Building
  // positions in BuildingLayer use the same projector configuration,
  // so target/position values here line up with rendered geometry.
  const project = useMemo(() => createNYCProjector({ worldSize: WORLD_SIZE }), []);

  const presets = useMemo(() => {
    const p = computePresets(data, project);
    // Override "All" so it actually frames the *currently filtered*
    // buildings instead of always showing the full city.
    p.all = computeFitPreset(data, project);
    return p;
  }, [data, project]);

  const preset = presets[activePreset] ?? presets.all ?? DEFAULT_PRESET;

  // CameraRig only re-animates when presetKey changes. Fold the resolved
  // target/position into the key so a filter change (which produces a new
  // 'all' fit preset) actually triggers the fly-to animation.
  const presetKey = useMemo(
    () =>
      `${activePreset}|${preset.target.join(',')}|${preset.position.join(',')}`,
    [activePreset, preset]
  );

  // When a borough preset is active, hide the other boroughs from the
  // scene entirely (buildings, tint, outline, label all get scoped down).
  // 'all' is a passthrough -- no extra work, no extra allocations.
  const visibleData = useMemo(() => {
    if (!data || activePreset === 'all') return data;
    return data.filter((d) => d.borough === activePreset);
  }, [data, activePreset]);

  const visibleFullData = useMemo(() => {
    if (!fullData || activePreset === 'all') return fullData;
    return fullData.filter((d) => d.borough === activePreset);
  }, [fullData, activePreset]);

  return (
    <Canvas
      shadows
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      camera={{
        position: DEFAULT_PRESET.position,
        // Tighter FOV than the previous 50 -- compresses depth slightly,
        // which is what gives architectural renders their "telephoto" feel
        // and keeps the buildings from looking warped at the closer
        // default distance.
        fov: 42,
        near: 0.1,
        far: 2000,
      }}
      style={{ width: '100%', height: '100%', background: '#f4f5f9' }}
    >
      <color attach="background" args={['#f4f5f9']} />
      {/* Subtle linear fog -- fades distant buildings into the bg color
          and gives the scene a sense of depth. Range tightened so the
          foreground genuinely separates from the back of the city
          (was [280, 700]; far distance got almost no fade). */}
      <fog attach="fog" args={['#f4f5f9', 180, 520]} />

      {/* Hemisphere light: warm sky tone above, cool ground tone below.
          Softens the directional light's contrast for friendlier shading. */}
      <hemisphereLight args={['#ffffff', '#aab2c8', 0.35]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[150, 200, 100]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <GroundPlane />
      {/* Tints sit just above the ground (y=0.04); boundary outlines
          sit just above the tints (y=0.08); buildings are above both.
          All four layers see the preset-scoped dataset so a borough
          preset hides the other boroughs everywhere consistently. */}
      <BoroughGroundTints data={visibleData} />
      <BoroughBoundaries data={visibleData} />
      <BuildingLayer
        data={visibleData}
        fullData={visibleFullData}
        hoveredId={hoveredId}
        onHoverChange={onHoverChange}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <BoroughLabels3D data={visibleData} />

      <CameraRig
        presetKey={presetKey}
        target={preset.target}
        position={preset.position}
      />
    </Canvas>
  );
}

export default CityScene3D;
