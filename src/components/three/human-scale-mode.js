// Human-Scale Inspection Mode -- the PDF's signature feature.
//
// When the user selects an area on the tabletop and presses
// "Enter Scale", we don't unmount the Canvas; we mount this subtree
// instead of the tabletop building groups. It computes a NEW
// projector from the selected cluster's lng/lat bbox at a much
// smaller worldSize so that buildings end up at meter scale, then
// re-extrudes those buildings at ~3 m/floor and drops the viewer
// inside the bbox with PointerLock walk controls.
//
// One Canvas + one XR session means transitions stay smooth and we
// don't have to re-enter AR / re-place / re-load footprints.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky, PointerLockControls, Text } from "@react-three/drei";
import { createProjection } from "../../utils/projection";
import {
  makeShapeFromRings,
  pickPrimaryRings,
} from "./footprint-building-layer";
import { resolveBuildingColor } from "../../utils/spatial-colors";
import ScenarioGhostLayer from "./scenario-ghost-layer";

// Cluster-local world size, in meters. ~120 m wide gives us a "block"
// view rather than a postcard view; the viewer at 1.7 m feels small
// relative to a 50-story tower (~150 m).
const HUMAN_WORLD_SIZE = 120;

// Realistic floor heights: 3 m per floor. Combined with HUMAN_WORLD_SIZE,
// a 12-story building reads as 36 m tall, the viewer is at 1.7 m, and
// the enclosure / scale ratio matches reality.
const HUMAN_HEIGHT_PER_FLOOR = 3;
const HUMAN_MIN_HEIGHT = 6;
const HUMAN_EYE = 1.7;

// Use a 1:1 polygon footprint (no inflation), so block widths match
// reality. The tabletop layer inflates by ~5x because at platform
// scale each polygon is sub-mm; here at meter scale they're already
// large enough.
const HUMAN_FOOTPRINT_SCALE = 1;

function hashId(id) {
  const str = String(id);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967295;
}

function clusterExtent(cluster) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of cluster.records) {
    const lng = +r.longitude;
    const lat = +r.latitude;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) {
    // Fallback: tiny extent around the cluster center.
    const [lng, lat] = cluster.centerLngLat;
    minLng = lng - 0.001;
    maxLng = lng + 0.001;
    minLat = lat - 0.001;
    maxLat = lat + 0.001;
  }
  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    centerLng: (minLng + maxLng) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
}

// One-time camera + control rig setup whenever the user enters human
// scale. Puts the camera at eye height in the middle of the cluster,
// looking toward the tallest nearby tower if possible.
function HumanCameraRig({ enabled, lookTarget }) {
  const { camera } = useThree();
  const initialized = useRef(false);
  useEffect(() => {
    if (!enabled) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    camera.position.set(0, HUMAN_EYE, 0);
    camera.fov = 70;
    camera.near = 0.1;
    camera.far = 600;
    camera.updateProjectionMatrix();
    if (lookTarget) {
      const t = new THREE.Vector3(lookTarget[0], HUMAN_EYE, lookTarget[2]);
      camera.lookAt(t);
    }
  }, [enabled, camera, lookTarget]);
  return null;
}

// Simple WASD / arrow-key movement. Composes with PointerLockControls
// (or any other camera control rig) by translating the camera in its
// local horizontal plane.
function WalkControls({ enabled, speed = 4 }) {
  const { camera } = useThree();
  const keys = useRef({});

  useEffect(() => {
    if (!enabled) return;
    const down = (e) => {
      keys.current[e.code] = true;
    };
    const up = (e) => {
      keys.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      keys.current = {};
    };
  }, [enabled]);

  const fwd = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    if (!enabled) return;
    const k = keys.current;
    const moveZ =
      (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    const moveX =
      (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (moveZ === 0 && moveX === 0) return;

    camera.getWorldDirection(fwd.current);
    fwd.current.y = 0;
    fwd.current.normalize();
    right.current.crossVectors(fwd.current, camera.up).normalize();

    const step = speed * Math.min(dt, 0.05);
    camera.position.addScaledVector(fwd.current, -moveZ * step);
    camera.position.addScaledVector(right.current, moveX * step);
    camera.position.y = HUMAN_EYE;
  });

  return null;
}

function HumanScaleMode({
  cluster,
  layerMode = "neutral",
  normalizer = null,
  footprintEntries = [],
  onHoverBuilding,
  onSelectBuilding,
  hoveredId,
  selectedId,
  enabled,
  inXR,
}) {
  // Project everything in the cluster relative to a new local origin.
  // The selected cluster's centroid becomes (0, 0); cluster radius +
  // a small margin sets the worldSize so all buildings fit comfortably.
  const project = useMemo(() => {
    if (!cluster) return null;
    const extent = clusterExtent(cluster);
    return createProjection(extent, { worldSize: HUMAN_WORLD_SIZE });
  }, [cluster]);

  // Filter footprint entries down to the cluster, then re-extrude in
  // human-scale meters with per-vertex coloring. Falls back to
  // bbox boxes for cluster records that don't have a resolved
  // footprint yet.
  const built = useMemo(() => {
    if (!cluster || !project) return null;
    const idSet = new Set(cluster.ids);
    const entries = footprintEntries.filter((e) => idSet.has(e.id));

    const geoms = [];
    const idByEntryIndex = [];
    const recordByEntryIndex = [];
    const heightByEntryIndex = [];
    const anchorByEntryIndex = [];

    for (const entry of entries) {
      const rings = pickPrimaryRings(entry.geometry);
      if (!rings) continue;
      const shape = makeShapeFromRings(
        rings,
        project,
        HUMAN_FOOTPRINT_SCALE
      );
      if (!shape) continue;

      const floors = Math.max(1, +entry.record.numfloors || 1);
      const height = Math.max(HUMAN_MIN_HEIGHT, floors * HUMAN_HEIGHT_PER_FLOOR);

      const { x: ax, z: az } = project(
        +entry.record.longitude,
        +entry.record.latitude
      );

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      }).rotateX(-Math.PI / 2);

      const count = geom.attributes.position.count;
      const ids = new Float32Array(count);
      ids.fill(idByEntryIndex.length);
      geom.setAttribute("bblId", new THREE.Float32BufferAttribute(ids, 1));
      geom.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3)
      );

      geoms.push(geom);
      idByEntryIndex.push(entry.id);
      recordByEntryIndex.push(entry.record);
      heightByEntryIndex.push(height);
      anchorByEntryIndex.push({
        id: entry.id,
        record: entry.record,
        pos: [ax, height, az],
        base: [ax, 0, az],
        height,
        floors,
      });
    }

    // Cluster records that don't have footprints get simple boxes
    // sized from bldgarea. This keeps the human-scale view dense
    // even before footprint streaming finishes.
    const haveFootprint = new Set(idByEntryIndex);
    const boxBuilds = [];
    for (const rec of cluster.records) {
      const id = rec.bbl || rec.bin || rec.id;
      if (!id || haveFootprint.has(id)) continue;
      const { x, z } = project(+rec.longitude, +rec.latitude);
      const floors = Math.max(1, +rec.numfloors || 1);
      const height = Math.max(HUMAN_MIN_HEIGHT, floors * HUMAN_HEIGHT_PER_FLOOR);
      const footprintSize = THREE.MathUtils.clamp(
        Math.sqrt(+rec.bldgarea || 1500) / 4,
        6,
        40
      );
      boxBuilds.push({
        id,
        record: rec,
        x,
        z,
        height,
        footprintSize,
        floors,
      });
    }

    if (!geoms.length && !boxBuilds.length) {
      return { boxes: [] };
    }

    let merged = null;
    let ranges = null;
    if (geoms.length) {
      merged = mergeGeometries(geoms, false);
      if (merged) {
        merged.computeVertexNormals();
        merged.computeBoundingSphere();
        ranges = new Array(geoms.length);
        let cursor = 0;
        for (let i = 0; i < geoms.length; i++) {
          const c = geoms[i].attributes.position.count;
          ranges[i] = { start: cursor, end: cursor + c };
          cursor += c;
        }
      }
      geoms.forEach((g) => g.dispose());
    }

    return {
      merged,
      ranges,
      idByEntryIndex,
      recordByEntryIndex,
      heightByEntryIndex,
      anchorByEntryIndex,
      boxes: boxBuilds,
    };
  }, [cluster, project, footprintEntries]);

  // Per-vertex color rebuild on layer-mode change. Mirrors the
  // logic in FootprintBuildingLayer.
  useEffect(() => {
    if (!built?.merged || !built?.ranges) return;
    const merged = built.merged;
    const colorAttr = merged.getAttribute("color");
    const posAttr = merged.getAttribute("position");
    if (!colorAttr || !posAttr) return;

    const tmp = new THREE.Color();
    const { ranges, idByEntryIndex, recordByEntryIndex, heightByEntryIndex } =
      built;
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      resolveBuildingColor(
        recordByEntryIndex[i],
        idByEntryIndex[i],
        null,
        null,
        hashId,
        tmp,
        { layerMode, normalizer, inCluster: true }
      );
      const height = heightByEntryIndex[i];
      for (let v = range.start; v < range.end; v++) {
        const y = posAttr.getY(v);
        const t = THREE.MathUtils.clamp(y / Math.max(height, 1e-6), 0, 1);
        const lift = 0.72 + 0.4 * t;
        colorAttr.array[v * 3] = tmp.r * lift;
        colorAttr.array[v * 3 + 1] = tmp.g * lift;
        colorAttr.array[v * 3 + 2] = tmp.b * lift;
      }
    }
    colorAttr.needsUpdate = true;
  }, [built, layerMode, normalizer]);

  // Find a look-target: the tallest building in the cluster.
  const lookTarget = useMemo(() => {
    if (!built) return null;
    let best = null;
    let bestH = 0;
    if (built.anchorByEntryIndex) {
      for (const a of built.anchorByEntryIndex) {
        if (a.height > bestH) {
          bestH = a.height;
          best = a.pos;
        }
      }
    }
    if (built.boxes) {
      for (const b of built.boxes) {
        if (b.height > bestH) {
          bestH = b.height;
          best = [b.x, b.height, b.z];
        }
      }
    }
    return best;
  }, [built]);

  // Raycast helper: faceIndex -> entry index via bblId attribute.
  const resolveAnchor = (event) => {
    if (!built?.merged) return null;
    const face = event.face;
    if (!face) return null;
    const attr = built.merged.getAttribute("bblId");
    if (!attr) return null;
    const idx = attr.getX(face.a);
    return built.anchorByEntryIndex?.[idx] ?? null;
  };

  const handlePointerMove = (event) => {
    event.stopPropagation();
    const anchor = resolveAnchor(event);
    if (anchor) onHoverBuilding?.(anchor);
  };

  const handlePointerOut = () => onHoverBuilding?.(null);

  const handleSelect = (event) => {
    event.stopPropagation();
    const anchor = resolveAnchor(event);
    if (anchor) onSelectBuilding?.(anchor);
  };

  if (!enabled || !cluster) return null;

  return (
    <group>
      {!inXR && <color attach="background" args={["#a8caea"]} />}
      {!inXR && <Sky distance={450000} sunPosition={[100, 30, 50]} inclination={0.49} />}

      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#cfe7ff", "#324250", 0.7]} />
      <directionalLight position={[80, 120, 60]} intensity={1.3} />

      {/* Ground plane sized to the local world. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        raycast={() => null}
      >
        <planeGeometry args={[HUMAN_WORLD_SIZE * 4, HUMAN_WORLD_SIZE * 4]} />
        <meshStandardMaterial color="#4a5664" roughness={0.95} />
      </mesh>

      {/* A subtle grid hint helps with depth perception while walking. */}
      <gridHelper
        args={[HUMAN_WORLD_SIZE * 2, 40, "#6f8795", "#3a4754"]}
        position={[0, 0.01, 0]}
      />

      {built?.merged && (
        <mesh
          geometry={built.merged}
          castShadow
          receiveShadow
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onPointerDown={handleSelect}
        >
          <meshStandardMaterial
            vertexColors
            roughness={0.7}
            metalness={0.1}
          />
        </mesh>
      )}

      {built?.boxes?.map((b) => (
        <mesh
          key={b.id}
          position={[b.x, b.height / 2, b.z]}
          castShadow
          receiveShadow
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelectBuilding?.({
              id: b.id,
              record: b.record,
              pos: [b.x, b.height, b.z],
              base: [b.x, 0, b.z],
              height: b.height,
              floors: b.floors,
            });
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            onHoverBuilding?.({
              id: b.id,
              record: b.record,
              pos: [b.x, b.height, b.z],
              base: [b.x, 0, b.z],
              height: b.height,
              floors: b.floors,
            });
          }}
          onPointerOut={() => onHoverBuilding?.(null)}
        >
          <boxGeometry args={[b.footprintSize, b.height, b.footprintSize]} />
          <meshStandardMaterial color="#8aa1b5" roughness={0.85} />
        </mesh>
      ))}

      <HumanCameraRig enabled={enabled && !inXR} lookTarget={lookTarget} />
      {enabled && !inXR && <WalkControls enabled />}
      {enabled && !inXR && <PointerLockControls makeDefault />}

      {/* Scenario ghosting at meter scale. The store keys match the
          tabletop view so adjustments persist across "Enter Scale" /
          "Return to Tabletop" toggles. */}
      <ScenarioGhostLayer
        project={project}
        entries={footprintEntries.filter((e) => cluster.ids.includes(e.id))}
        heightPerFloor={HUMAN_HEIGHT_PER_FLOOR}
        minHeight={HUMAN_MIN_HEIGHT}
        footprintScale={HUMAN_FOOTPRINT_SCALE}
        labelScale={1.2}
      />

      {/* "You are here" floor disc + helper label. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        raycast={() => null}
      >
        <ringGeometry args={[0.45, 0.5, 48]} />
        <meshBasicMaterial color="#9af7c0" transparent opacity={0.75} />
      </mesh>
      <Text
        position={[0, 2.4, -2]}
        fontSize={0.25}
        color="#dff8ff"
        anchorX="center"
        anchorY="middle"
        outlineColor="#0a1d18"
        outlineWidth={0.015}
      >
        {`Inside cluster · ${cluster.summary.count} buildings`}
      </Text>

      {/* In-scene selected anchor + hover ring (visible above ground
          even when the user looks down). */}
      {hoveredId != null && hoveredId !== selectedId && (
        <SelectionAnchorRing
          built={built}
          targetId={hoveredId}
          color="#ff4f8b"
        />
      )}
      {selectedId != null && (
        <SelectionAnchorRing
          built={built}
          targetId={selectedId}
          color="#39d5ff"
        />
      )}
    </group>
  );
}

function SelectionAnchorRing({ built, targetId, color }) {
  if (!built) return null;
  let pos = null;
  let radius = 4;
  if (built.anchorByEntryIndex) {
    const a = built.anchorByEntryIndex.find((x) => x.id === targetId);
    if (a) {
      pos = a.pos;
      radius = 6;
    }
  }
  if (!pos && built.boxes) {
    const b = built.boxes.find((x) => x.id === targetId);
    if (b) {
      pos = [b.x, b.height, b.z];
      radius = Math.max(4, b.footprintSize * 0.7);
    }
  }
  if (!pos) return null;
  return (
    <mesh
      position={[pos[0], 0.05, pos[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <ringGeometry args={[radius * 0.85, radius, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.75} />
    </mesh>
  );
}

export {
  HUMAN_EYE,
  HUMAN_HEIGHT_PER_FLOOR,
  HUMAN_MIN_HEIGHT,
  HUMAN_WORLD_SIZE,
};
export default HumanScaleMode;
