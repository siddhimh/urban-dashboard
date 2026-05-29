// Radius-brush cluster selection.
//
// Pure helpers for computing a cluster from a center building +
// radius (in world units). The interaction layer (shift-click in the
// building layers + a slider in the DOM panel) drives the parent's
// `selectedCluster` state via these helpers; the rendering of the
// cluster halo lives in this module so the disc + ring follow the
// same transform as the building layers.

import { useMemo } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { SPATIAL_CLUSTER } from "../../utils/spatial-colors";

const LAND_USE_LABELS = {
  "1": "One & Two Family",
  "2": "Multi-Family Walk-Up",
  "3": "Multi-Family Elevator",
  "4": "Mixed Res / Commercial",
  "5": "Commercial & Office",
  "6": "Industrial & Manufacturing",
  "7": "Transport & Utility",
  "8": "Public Facilities",
  "9": "Open Space",
  "10": "Parking",
  "11": "Vacant Land",
};

function getRecordId(d, index) {
  return d.bbl || d.bin || d.id || index;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mode(values) {
  if (!values.length) return null;
  const counts = new Map();
  let best = null;
  let bestCount = -1;
  for (const v of values) {
    if (v == null || v === "") continue;
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

/**
 * Compute a cluster from a center (in the same world coords the
 * projector emits) and a world-space radius. Walks the dataset once
 * with a squared-distance test.
 *
 * Returns:
 *   {
 *     centerId,
 *     center:   [x, z],         // world coords
 *     centerLngLat: [lng, lat], // for cluster-local reprojection
 *     radius,                   // world units
 *     ids:      [...],          // record ids in the cluster
 *     indices:  [...],          // dataset indices in the cluster
 *     records:  [...],          // raw records
 *     summary:  { ...stats... }
 *   }
 */
export function buildCluster({
  data,
  project,
  centerRecord,
  centerIndex,
  radius,
}) {
  if (!project || !centerRecord) return null;
  const { x: cx, z: cz } = project(
    +centerRecord.longitude,
    +centerRecord.latitude
  );
  const r2 = radius * radius;

  const ids = [];
  const indices = [];
  const records = [];
  const floors = [];
  const years = [];
  const landuses = [];
  let tallest = null;
  let tallestFloors = -Infinity;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d) continue;
    const lng = +d.longitude;
    const lat = +d.latitude;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const { x, z } = project(lng, lat);
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz > r2) continue;

    const id = getRecordId(d, i);
    ids.push(id);
    indices.push(i);
    records.push(d);

    const f = +d.numfloors;
    if (Number.isFinite(f) && f > 0) {
      floors.push(f);
      if (f > tallestFloors) {
        tallestFloors = f;
        tallest = d;
      }
    }
    const y = +d.yearbuilt;
    if (Number.isFinite(y) && y > 0) years.push(y);
    if (d.landuse != null && d.landuse !== "") {
      landuses.push(String(Math.round(+d.landuse)));
    }
  }

  const avgFloors = floors.length
    ? floors.reduce((a, b) => a + b, 0) / floors.length
    : null;
  const dominantLanduse = mode(landuses);
  const dominantLanduseLabel = dominantLanduse
    ? LAND_USE_LABELS[dominantLanduse] ?? `Land Use ${dominantLanduse}`
    : null;

  // Density score: buildings per square world-unit, rescaled to a
  // 0..100 readable number. The user only cares about relative
  // density between clusters, not its raw units.
  const area = Math.PI * radius * radius;
  const rawDensity = ids.length / Math.max(area, 1e-6);
  const densityScore = Math.round(rawDensity * 100);

  return {
    centerId: getRecordId(centerRecord, centerIndex),
    center: [cx, cz],
    centerLngLat: [+centerRecord.longitude, +centerRecord.latitude],
    radius,
    ids,
    indices,
    records,
    summary: {
      count: ids.length,
      avgFloors,
      tallest,
      tallestFloors: Number.isFinite(tallestFloors) ? tallestFloors : null,
      medianYear: median(years),
      dominantLanduse,
      dominantLanduseLabel,
      densityScore,
    },
  };
}

// Re-compute a cluster around the same center with a new radius
// (used by the radius slider). centerIndex / centerRecord are looked
// up from the original cluster object so the caller doesn't have to
// thread them through.
export function recomputeCluster(prevCluster, data, project, nextRadius) {
  if (!prevCluster) return null;
  // Find center record by id.
  const centerId = prevCluster.centerId;
  let centerRecord = null;
  let centerIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d) continue;
    const id = d.bbl || d.bin || d.id || i;
    if (id === centerId) {
      centerRecord = d;
      centerIndex = i;
      break;
    }
  }
  if (!centerRecord) return null;
  return buildCluster({
    data,
    project,
    centerRecord,
    centerIndex,
    radius: nextRadius,
  });
}

/**
 * Visual halo for the active cluster: a translucent disc on the
 * platform + a glowing ring at the edge. Lives in the building-
 * layer-local coord system so the parent group's transform applies.
 */
export function ClusterHalo({ cluster }) {
  const data = useMemo(() => {
    if (!cluster) return null;
    return {
      x: cluster.center[0],
      z: cluster.center[1],
      r: cluster.radius,
    };
  }, [cluster]);

  if (!data) return null;
  const inner = data.r * 0.98;
  const outer = data.r * 1.05;

  return (
    <group position={[data.x, 0.002, data.z]} raycast={() => null}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[data.r, 64]} />
        <meshBasicMaterial
          color={SPATIAL_CLUSTER}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]}>
        <ringGeometry args={[inner, outer, 96]} />
        <meshBasicMaterial
          color={SPATIAL_CLUSTER}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Floating cluster label. Sits above the cluster halo at the platform
 * surface. drei <Text> renders into the WebGL scene so it survives
 * AR sessions (no DOM overlay).
 */
export function ClusterLabel({ cluster, detailed = false }) {
  if (!cluster) return null;
  const { count, avgFloors, tallestFloors } = cluster.summary;
  const lines = detailed
    ? [
        `${count} buildings`,
        `Avg ${Number.isFinite(avgFloors) ? Math.round(avgFloors) : "—"} fl · Tallest ${tallestFloors ?? "—"} fl`,
        "Enter Scale to step inside",
      ].join("\n")
    : `${count} buildings`;

  return (
    <Text
      position={[cluster.center[0], detailed ? 0.85 : 0.6, cluster.center[1]]}
      fontSize={detailed ? 0.14 : 0.18}
      color="#caffec"
      anchorX="center"
      anchorY="middle"
      outlineColor="#0a1d18"
      outlineWidth={0.012}
      maxWidth={2.2}
      lineHeight={1.15}
      textAlign="center"
    >
      {lines}
    </Text>
  );
}
