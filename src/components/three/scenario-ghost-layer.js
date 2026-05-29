// Scenario Ghosting renderer.
//
// Reads the scenario store and, for any building with a proposed
// height, draws TWO extra meshes:
//
//   1. A transparent "ghost" of the original mass (so the user can
//      still see what's being replaced).
//   2. A solid emissive "proposed" mass at the new height.
//
// These overlay the merged building mesh; the user only sees a
// difference where they've actually adjusted a building.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import {
  makeShapeFromRings,
  pickPrimaryRings,
  HEIGHT_PER_FLOOR,
  MIN_HEIGHT,
} from "./footprint-building-layer";
import { useScenarioStore } from "./scenario-store";

// Per-building entry shape mirrors the FootprintBuildingLayer's
// `entries` prop: { id, record, geometry, heightRoof? }.
//
// Props:
//   project         shared projector
//   entries         resolved footprint entries (same source as the merged layer)
//   heightPerFloor  scene units per floor (matches the active layer)
//   minHeight       floor for "1 floor" buildings
//   footprintScale  inflation factor applied by makeShapeFromRings
//   showLabel       optional override for the +/- floors label
//
// Renders nothing when no proposals are active.

function ScenarioGhostLayer({
  project,
  entries = [],
  heightPerFloor = HEIGHT_PER_FLOOR,
  minHeight = MIN_HEIGHT,
  footprintScale = 5,
  labelScale = 0.35,
  showLabel = true,
}) {
  const proposals = useScenarioStore();

  // Build a map id -> entry for fast lookup of geometry when a
  // proposal exists. Entries can be large; this stays cheap because
  // it's only walked once per change.
  const entryById = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.id, e);
    return map;
  }, [entries]);

  // For each active proposal that has an entry, build a ghost geom
  // (at original height, transparent) and a proposed geom (at new
  // height, solid emissive). Disposed on prop change.
  const built = useMemo(() => {
    if (!project) return [];
    const out = [];
    for (const [id, prop] of proposals.entries()) {
      const entry = entryById.get(id);
      if (!entry) continue;
      const rings = pickPrimaryRings(entry.geometry);
      if (!rings) continue;
      const shape = makeShapeFromRings(rings, project, footprintScale);
      if (!shape) continue;

      const origFloors = Math.max(1, +entry.record.numfloors || 1);
      const origHeight = Math.max(minHeight, origFloors * heightPerFloor);
      const proposed = prop.proposedFloors;
      const propHeight = Math.max(minHeight, proposed * heightPerFloor);

      const ghostGeom = new THREE.ExtrudeGeometry(shape, {
        depth: origHeight,
        bevelEnabled: false,
      }).rotateX(-Math.PI / 2);

      const propGeom = new THREE.ExtrudeGeometry(shape, {
        depth: propHeight,
        bevelEnabled: false,
      }).rotateX(-Math.PI / 2);

      const { x, z } = project(
        +entry.record.longitude,
        +entry.record.latitude
      );

      out.push({
        id,
        ghostGeom,
        propGeom,
        origFloors,
        proposedFloors: proposed,
        delta: proposed - origFloors,
        labelPos: [x, propHeight + minHeight * 0.5, z],
      });
    }
    return out;
  }, [
    proposals,
    entryById,
    project,
    heightPerFloor,
    minHeight,
    footprintScale,
  ]);

  // Dispose previous geometries when `built` changes.
  const prev = useRef([]);
  useEffect(() => {
    const old = prev.current;
    prev.current = built;
    for (const b of old) {
      if (!built.includes(b)) {
        b.ghostGeom?.dispose();
        b.propGeom?.dispose();
      }
    }
  }, [built]);
  useEffect(() => {
    return () => {
      for (const b of prev.current) {
        b.ghostGeom?.dispose();
        b.propGeom?.dispose();
      }
    };
  }, []);

  if (built.length === 0) return null;

  return (
    <group raycast={() => null}>
      {built.map((b) => (
        <group key={b.id}>
          <mesh geometry={b.ghostGeom} renderOrder={3}>
            <meshStandardMaterial
              color="#dff8ff"
              transparent
              opacity={0.22}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={b.propGeom} renderOrder={4}>
            <meshStandardMaterial
              color="#ffb86c"
              emissive="#ff6b3d"
              emissiveIntensity={0.35}
              roughness={0.4}
              metalness={0.2}
              transparent
              opacity={0.92}
            />
          </mesh>
          {showLabel && (
            <Text
              position={b.labelPos}
              fontSize={labelScale}
              color="#ffe6a8"
              anchorX="center"
              anchorY="middle"
              outlineColor="#1a0a00"
              outlineWidth={labelScale * 0.08}
            >
              {`${b.delta > 0 ? "+" : ""}${b.delta} floors`}
            </Text>
          )}
        </group>
      ))}
    </group>
  );
}

export default ScenarioGhostLayer;
