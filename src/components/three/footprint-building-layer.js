import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  resolveBuildingColor,
  SPATIAL_HOVER,
  SPATIAL_SELECT,
} from "../../utils/spatial-colors";

// Phase 2 sizing: matches SpatialBuildingLayer so a record looks the
// same height whether it's still on the box renderer or has been
// upgraded to a real footprint extrusion.
const HEIGHT_PER_FLOOR = 0.06;
const MIN_HEIGHT = 0.18;

export {
  HEIGHT_PER_FLOOR,
  MIN_HEIGHT,
  makeShapeFromRings,
  pickPrimaryRings,
};

// Real NYC building footprints are ~10-20 m across; the platform
// represents ~22 km of Manhattan, so each polygon naturally projects
// to ~0.01 units (sub-pixel at typical zoom). Scaling each footprint
// uniformly around its own centroid keeps the actual shape (L's,
// courtyards, irregular setbacks) and the geographic position, while
// turning each building into a readable chunk. The model becomes a
// stylized "block diagram of Manhattan" rather than a literal map.
const FOOTPRINT_SCALE = 5;

function hashId(id) {
  const str = String(id);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967295;
}

// Build a THREE.Shape from a GeoJSON Polygon ring set in (lng, lat),
// projecting each vertex through the shared NYC projector. The shape
// lives in the X/Y plane of the shape itself; we'll rotate the
// extrusion into world Y-up after constructing each geometry.
//
// The shape's Y is set to -projector.z so that, after rotateX(-π/2),
// world Z lines up with projector.z (north -> -z). To keep winding
// CCW after that 2D Y-mirror -- and therefore keep extrusion normals
// pointing outward -- we walk the ring backwards.
//
// Each vertex is also scaled by FOOTPRINT_SCALE around the centroid
// of the outer ring -- this enlarges the polygon without moving the
// building's geographic position.
function ringCentroidProjected(ring, project) {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const [lng, lat] of ring) {
    const { x, z } = project(lng, lat);
    sx += x;
    sz += z;
    n++;
  }
  if (n === 0) return null;
  return { cx: sx / n, cz: sz / n };
}

function emitRing(path, ring, project, cx, cz, footprintScale) {
  for (let i = ring.length - 1; i >= 0; i--) {
    const [lng, lat] = ring[i];
    const { x, z } = project(lng, lat);
    const sx = cx + (x - cx) * footprintScale;
    const sz = cz + (z - cz) * footprintScale;
    if (i === ring.length - 1) path.moveTo(sx, -sz);
    else path.lineTo(sx, -sz);
  }
}

function makeShapeFromRings(rings, project, footprintScale = FOOTPRINT_SCALE) {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;

  const c = ringCentroidProjected(outer, project);
  if (!c) return null;

  const shape = new THREE.Shape();
  emitRing(shape, outer, project, c.cx, c.cz, footprintScale);
  shape.closePath();

  for (let h = 1; h < rings.length; h++) {
    const ring = rings[h];
    if (!ring || ring.length < 3) continue;
    const hole = new THREE.Path();
    emitRing(hole, ring, project, c.cx, c.cz, footprintScale);
    hole.closePath();
    shape.holes.push(hole);
  }

  return shape;
}

// GeoJSON Polygon -> [rings]. MultiPolygon -> [rings of largest polygon].
// We pick a single representative polygon per building so the merged
// geometry has a single contiguous footprint per bblId; the alternative
// would mean storing a one-to-many map for raycasting.
function pickPrimaryRings(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") {
    let best = null;
    let bestVerts = -1;
    for (const poly of geometry.coordinates) {
      const verts = poly?.[0]?.length ?? 0;
      if (verts > bestVerts) {
        bestVerts = verts;
        best = poly;
      }
    }
    return best;
  }
  return null;
}

function FootprintBuildingLayer({
  entries = [],
  project,
  hoveredId,
  selectedId,
  onHoverChange,
  onSelect,
  layerMode = "neutral",
  normalizer = null,
  clusterIds = null,
  heightPerFloor = HEIGHT_PER_FLOOR,
  minHeight = MIN_HEIGHT,
  footprintScale = FOOTPRINT_SCALE,
}) {
  const meshRef = useRef();

  // Sub-geometry per entry, plus an entryIndex<->id index. We build
  // the merged geometry from these so a face's bblId attribute can be
  // mapped back to a record / id. Color rebuild is split into its own
  // effect so layer-mode swaps don't trigger a full re-extrude.
  const built = useMemo(() => {
    if (!project || entries.length === 0) return null;

    const geoms = [];
    const idByEntryIndex = [];
    const recordByEntryIndex = [];
    const anchorByEntryIndex = [];
    const heightByEntryIndex = [];

    entries.forEach((entry) => {
      const rings = pickPrimaryRings(entry.geometry);
      if (!rings) return;

      const shape = makeShapeFromRings(rings, project, footprintScale);
      if (!shape) return;

      const floors = Math.max(1, +entry.record.numfloors || 1);
      const height = Math.max(minHeight, floors * heightPerFloor);

      // Project the building's PLUTO point as the anchor for the
      // floating tooltip / platform halo ring. The shape's centroid
      // would be marginally more accurate but the PLUTO coord is
      // already on hand and matches what the box layer reports.
      const { x: ax, z: az } = project(
        +entry.record.longitude,
        +entry.record.latitude
      );

      // ExtrudeGeometry extrudes along +Z and ships non-indexed,
      // which is exactly what we want: rotate to +Y so the building
      // stands up, and face.a/b/c map directly into the position
      // buffer post-merge (no index lookup needed for bblId).
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      }).rotateX(-Math.PI / 2);

      // bblId attribute: store the entry index (constant across every
      // vertex of this building). After merge, raycast.face.a is a
      // direct lookup into this attribute -> entry index -> record.
      const entryIndex = idByEntryIndex.length;
      const count = geom.attributes.position.count;
      const ids = new Float32Array(count);
      ids.fill(entryIndex);
      geom.setAttribute("bblId", new THREE.Float32BufferAttribute(ids, 1));

      // Allocate (uninitialized) color attribute up front so the
      // merge step has it; the color effect below fills it in.
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
        // Approximate radius of the scaled footprint in world units.
        // A typical NYC building's bldgarea (sqft) -> sqrt -> meters,
        // converted to world units via the platform scale, scaled by
        // FOOTPRINT_SCALE. Falls back to a small default for missing
        // area so the halo ring still gets a sensible size.
        footprint: Math.max(
          0.18,
          Math.min(0.6, Math.sqrt(+entry.record.bldgarea || 2000) / 320) *
            footprintScale
        ),
      });
    });

    if (!geoms.length) return null;

    const merged = mergeGeometries(geoms, false);
    if (!merged) return null;
    merged.computeVertexNormals();
    merged.computeBoundingSphere();

    // Per-entry vertex ranges, used for selection-highlight overlay.
    const ranges = new Array(geoms.length);
    let cursor = 0;
    for (let i = 0; i < geoms.length; i++) {
      const c = geoms[i].attributes.position.count;
      ranges[i] = { start: cursor, end: cursor + c };
      cursor += c;
    }

    // Sub-geometries are no longer needed once merged.
    geoms.forEach((g) => g.dispose());

    return {
      merged,
      idByEntryIndex,
      recordByEntryIndex,
      ranges,
      anchorByEntryIndex,
      heightByEntryIndex,
    };
  }, [entries, project, heightPerFloor, minHeight, footprintScale]);

  // Per-vertex coloring -- rebuild only when the relevant inputs
  // change. Independently of merged-geometry construction so layer
  // mode swaps stay cheap.
  useEffect(() => {
    if (!built) return;
    const merged = built.merged;
    const colorAttr = merged.getAttribute("color");
    if (!colorAttr) return;
    const posAttr = merged.getAttribute("position");
    if (!posAttr) return;

    const tmp = new THREE.Color();
    const ranges = built.ranges;
    const ids = built.idByEntryIndex;
    const records = built.recordByEntryIndex;
    const heights = built.heightByEntryIndex;

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const id = ids[i];
      const record = records[i];
      const height = heights[i];

      resolveBuildingColor(record, id, null, null, hashId, tmp, {
        layerMode,
        normalizer,
        inCluster: clusterIds ? clusterIds.has(id) : false,
      });

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
  }, [built, layerMode, normalizer, clusterIds]);

  // Dispose merged geometry on unmount / rebuild.
  useEffect(() => {
    return () => {
      built?.merged?.dispose();
    };
  }, [built]);

  // Selection-highlight: a sibling geometry for just the selected
  // building, with an emissive cyan material so it pops out of the
  // merged mesh underneath.
  const selectionGeom = useMemo(() => {
    if (!built || selectedId == null) return null;
    const idx = built.idByEntryIndex.indexOf(selectedId);
    if (idx < 0) return null;
    const range = built.ranges[idx];
    const src = built.merged.attributes.position;
    const slice = new Float32Array(src.array.buffer, src.array.byteOffset + range.start * 3 * 4, (range.end - range.start) * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(slice.slice(), 3));
    geom.computeVertexNormals();
    return geom;
  }, [built, selectedId]);

  useEffect(() => {
    return () => selectionGeom?.dispose();
  }, [selectionGeom]);

  const resolveAnchor = (event) => {
    if (!built) return null;
    const face = event.face;
    if (!face) return null;
    const attr = built.merged.getAttribute("bblId");
    if (!attr) return null;
    const entryIndex = attr.getX(face.a);
    return built.anchorByEntryIndex[entryIndex] ?? null;
  };

  const handlePointerMove = (event) => {
    event.stopPropagation();
    const anchor = resolveAnchor(event);
    if (!anchor) return;
    onHoverChange?.(anchor);
  };

  const handlePointerOut = () => {
    onHoverChange?.(null);
  };

  // Select on pointerdown rather than click. See the note in
  // spatial-building-layer.js -- `click` is unreliable in XR.
  // Forward the shift key state -- the scene treats shift-click as a
  // cluster-brush pick instead of single building select.
  const handleSelect = (event) => {
    event.stopPropagation();
    const anchor = resolveAnchor(event);
    if (!anchor) return;
    onSelect?.({ ...anchor, shiftKey: !!event.shiftKey });
  };

  if (!built) return null;

  // Hover tint is applied through emissive on the shared material.
  const hoverIdx = hoveredId != null ? built.idByEntryIndex.indexOf(hoveredId) : -1;

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={built.merged}
        castShadow
        receiveShadow
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handleSelect}
        onClick={handleSelect}
      >
        <meshStandardMaterial
          vertexColors
          roughness={0.6}
          metalness={0.15}
        />
      </mesh>

      {selectionGeom && (
        <mesh geometry={selectionGeom} renderOrder={2}>
          <meshStandardMaterial
            color={SPATIAL_SELECT}
            emissive={SPATIAL_SELECT}
            emissiveIntensity={0.55}
            roughness={0.4}
            metalness={0.2}
            transparent
            opacity={0.92}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}

      {hoverIdx >= 0 && (
        <HoverHalo
          built={built}
          entryIndex={hoverIdx}
          color={SPATIAL_HOVER}
        />
      )}
    </group>
  );
}

// Lightweight hover overlay for the footprint layer. Rebuilds a tiny
// per-building geometry only on hover changes (not on every frame),
// so cost is negligible.
function HoverHalo({ built, entryIndex, color }) {
  const geom = useMemo(() => {
    const range = built.ranges[entryIndex];
    if (!range) return null;
    const src = built.merged.attributes.position;
    const length = (range.end - range.start) * 3;
    const slice = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      slice[i] = src.array[range.start * 3 + i];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(slice, 3));
    g.computeVertexNormals();
    return g;
  }, [built, entryIndex]);

  useEffect(() => {
    return () => geom?.dispose();
  }, [geom]);

  if (!geom) return null;
  return (
    <mesh geometry={geom} renderOrder={1}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.35}
        roughness={0.55}
        metalness={0.2}
        transparent
        opacity={0.85}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

export default FootprintBuildingLayer;
