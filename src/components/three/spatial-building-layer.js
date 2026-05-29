import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { resolveBuildingColor } from "../../utils/spatial-colors";

// Phase 2 sizing: with platform worldSize=12, this makes a 50-floor
// tower read tall (~3 units) without overwhelming the scene.
const HEIGHT_PER_FLOOR = 0.06;
const MIN_HEIGHT = 0.18;

function getRecordId(d, index) {
  return d.bbl || d.bin || d.id || index;
}

// Cheap deterministic hash of a record id -> [0, 1). Used to nudge
// per-building color so rooftops don't form a uniform color sheet.
function hashId(id) {
  const str = String(id);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967295;
}

function SpatialBuildingLayer({
  data = [],
  project,
  hoveredId,
  selectedId,
  onHoverChange,
  onSelect,
  maxBuildings = 5000,
  layerMode = "neutral",
  normalizer = null,
  clusterIds = null,
}) {
  const meshRef = useRef();

  const visibleData = useMemo(() => {
    return data
      .filter((d) => Number.isFinite(+d.longitude) && Number.isFinite(+d.latitude))
      .slice(0, maxBuildings);
  }, [data, maxBuildings]);

  const instances = useMemo(() => {
    if (!project) return [];
    return visibleData.map((d, index) => {
      const { x, z } = project(+d.longitude, +d.latitude);

      const floors = Math.max(1, +d.numfloors || 1);
      const height = Math.max(MIN_HEIGHT, floors * HEIGHT_PER_FLOOR);

      // Boxes are an instant-render placeholder; they slightly
      // exaggerate the real footprint so the box-only view (while
      // footprints stream in) still reads as a dense city, not a
      // pinprick dot map. Once the matching footprint resolves, the
      // record gets handed off to FootprintBuildingLayer.
      const area = +d.bldgarea || 0;
      const footprint = THREE.MathUtils.clamp(
        Math.sqrt(area) / 320,
        0.12,
        0.38
      );

      const id = getRecordId(d, index);
      return {
        record: d,
        id,
        x,
        z,
        height,
        footprint,
      };
    });
  }, [visibleData, project]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();
    const active = Math.min(instances.length, maxBuildings);

    for (let index = 0; index < active; index++) {
      const item = instances[index];
      dummy.position.set(item.x, item.height / 2, item.z);
      dummy.scale.set(item.footprint, item.height, item.footprint);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);

      resolveBuildingColor(
        item.record,
        item.id,
        hoveredId,
        selectedId,
        hashId,
        tmpColor,
        {
          layerMode,
          normalizer,
          inCluster: clusterIds ? clusterIds.has(item.id) : false,
        }
      );
      mesh.setColorAt(index, tmpColor);
    }

    // Only render the active prefix. The buffer keeps its full
    // `maxBuildings` capacity so the underlying THREE.InstancedMesh
    // is never re-allocated as the active count fluctuates while
    // footprints stream in.
    mesh.count = active;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [
    instances,
    hoveredId,
    selectedId,
    maxBuildings,
    layerMode,
    normalizer,
    clusterIds,
  ]);

  // Build the anchor position the scene uses to float a tooltip /
  // selection ring. We sit it at the top of the box (item.height)
  // in the layer's local coords -- the parent group transforms it
  // into world space. `index` is the dataset index (after filter +
  // slice) -- the scene needs it to compute clusters back in lng/lat
  // space.
  const buildAnchor = (item, index) => ({
    id: item.id,
    record: item.record,
    index,
    pos: [item.x, item.height, item.z],
    base: [item.x, 0, item.z],
    footprint: item.footprint,
  });

  const handlePointerMove = (event) => {
    event.stopPropagation();
    const instanceId = event.instanceId;
    if (instanceId == null) return;
    const item = instances[instanceId];
    if (!item) return;
    onHoverChange?.(buildAnchor(item, instanceId));
  };

  const handlePointerOut = () => {
    onHoverChange?.(null);
  };

  // Select on pointerdown (not click). In XR the controller ray
  // shifts a few pixels between trigger-press and trigger-release,
  // which means `click` (= same target on down+up) rarely fires on
  // a small instance. `pointerdown` fires immediately on press.
  // Forward shift-key state so the scene can route this as a
  // cluster-brush pick instead of a single-building select.
  const handleSelect = (event) => {
    event.stopPropagation();
    const instanceId = event.instanceId;
    if (instanceId == null) return;
    const item = instances[instanceId];
    if (!item) return;
    const anchor = buildAnchor(item, instanceId);
    anchor.shiftKey = !!event.shiftKey;
    onSelect?.(anchor);
  };

  // The mesh is allocated for the full `maxBuildings` capacity so
  // the args (and the underlying THREE.InstancedMesh instance)
  // never change as the active prefix shrinks during footprint
  // streaming. Unused slots get zero-scaled in the effect above.
  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, maxBuildings]}
      castShadow
      receiveShadow
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerDown={handleSelect}
      onClick={handleSelect}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#ffffff"
        roughness={0.62}
        metalness={0.18}
      />
    </instancedMesh>
  );
}

export default SpatialBuildingLayer;
