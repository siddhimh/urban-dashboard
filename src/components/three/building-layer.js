// Building layer for the 3D city scene.
//
// 3-LAYER HIERARCHY (back-to-front, weakest -> strongest):
//
//   1. CONTEXT layer   -- every building in `fullData` rendered as a
//      flat, lightened, low-opacity tile. Preserves the city silhouette
//      so the focus subset reads in its real neighborhood instead of
//      floating in a void. No shadows, no raycast (click-through).
//      Skipped when no filter is active (context == focus, redundant).
//
//   2. FOCUS layer     -- the filtered records in `data`. Per-borough
//      colored, full real height, casts shadows, hover/click enabled.
//      The user's primary read. Sits on top of the context tile at
//      the same xz position.
//
//   3. SELECTION layer -- the chosen building. Bright accent outline
//      around the building plus a translucent ground halo at its base
//      for unmistakable visual lock-on. Doesn't touch the InstancedMesh
//      buffers; trivially toggled by selectedId.
//
// Both meshes share the same projector + footprint, so a building's
// silhouette is identical regardless of which layer it lives in. The
// focus layer's MIN_HEIGHT is set above the context tile height so a
// 0-floor focus building still rises cleanly above its context base.
//
// Inputs:
//   - data: array of records with { latitude, longitude, borough, numfloors }
//   - fullData: optional, the unfiltered dataset. When omitted (or equal
//               in length to `data`) no context renders.
//   - hoveredId    : instance id currently hovered (lifted into CityView3D)
//   - onHoverChange: (instanceId | null) => void
//   - selectedId   : instance id currently selected (lifted into CityView3D)
//   - onSelect     : (record, instanceId) => void  -- bubbled to App for
//                    integration with shared 2D filter state
//   - tunables: worldSize, heightPerFloor, footprint, maxBuildings

import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { createNYCProjector } from '../../utils/projection';
import { getBoroughColor } from '../../utils/building-color';
import BuildingTooltip from './building-tooltip';

// NYC bounding box -- mirrors the filter used by the 2D DotMap so the
// two views agree on what counts as a "valid" building location.
const NYC_BOUNDS = {
  minLat: 40.4,
  maxLat: 40.95,
  minLng: -74.3,
  maxLng: -73.65,
};

// Slight bump (1.2 -> 1.35) so focus buildings carry a little more
// vertical weight against the much-flattened context. Keeps the
// building:footprint aspect ratio reading as "skyline".
const DEFAULT_HEIGHT_PER_FLOOR = 1.35;
// Footprint sized so adjacent buildings in dense areas leave a visible
// gap (read as "streets") rather than fusing into a single mass.
const DEFAULT_FOOTPRINT = 1.3;
const DEFAULT_WORLD_SIZE = 300;
const DEFAULT_MAX_BUILDINGS = 20000;
// Sits cleanly above CONTEXT_HEIGHT (0.35). A 0/1-floor focus building
// still clearly rises above the flat context tile underneath it.
const MIN_HEIGHT = 0.9;
const MAX_FLOORS = 120;
// Small lift so the tooltip floats above the rooftop, not embedded in it.
const TOOLTIP_Y_OFFSET = 1.5;

// ---- Context layer styling ----
//
// Aggressively recessive: very light, nearly-flat, low opacity. Reads
// as a colored "map tile" of where buildings exist, not as buildings
// competing with the focus subset.
//
// How far to lerp the borough color toward white. 0 = full hue,
// 1 = pure white. ~0.82 keeps borough identity just barely legible
// while clearly reading as "background wash".
const CONTEXT_LIGHTEN = 0.82;
// Near-flat tile height -- ignores numfloors on purpose. Low enough
// that the context reads as ground texture rather than architecture,
// but tall enough that the borough hue still catches the light.
const CONTEXT_HEIGHT = 0.35;
// Very low opacity so the city fades into the background at all camera
// distances. The focus layer and its outline dominate by contrast.
const CONTEXT_OPACITY = 0.28;

// ---- Selection layer styling ----
//
// Bright accent that contrasts with the borough palette + the off-white
// background. Used by the shell, the emissive overlay, and the halo.
const SELECTION_COLOR = '#ffd54a';
// Emissive overlay at the building's exact position, slightly upscaled.
// Gives the selected building a subtle self-lit glow and a visible
// "push forward" against its neighbors. 1.05 is small enough not to
// overlap adjacent buildings, big enough to read as "this one is
// special".
const SELECTION_OVERLAY_SCALE = 1.05;
const SELECTION_OVERLAY_OPACITY = 0.32;
const SELECTION_EMISSIVE_INTENSITY = 0.65;
// "Inflated shell" outline: a second box scaled slightly larger than
// the building, rendered with side=BackSide so only the far-side faces
// draw. At the silhouette edges those back faces peek past the building,
// producing a thick colored rim that doesn't depend on GL line width
// (WebGL pins wireframe lines to 1 device pixel on most drivers, so
// thin wireframes never actually read as "thick" no matter the config).
const SELECTION_SHELL_SCALE = 1.1;
const SELECTION_SHELL_OPACITY = 0.92;
// Ground halo sits flat at the base; footprint scales out from the
// building's footprint so it reads as a "spotlight" on the floor.
const SELECTION_HALO_THICKNESS = 0.12;
const SELECTION_HALO_PAD_XZ = 2.6;

// Tiny per-borough cache so we don't re-allocate THREE.Color objects
// for every context instance. Each entry is the lightened version.
const contextColorCache = new Map();
const _white = new THREE.Color(0xffffff);
function getContextColor(borough) {
  let c = contextColorCache.get(borough);
  if (c) return c;
  c = new THREE.Color(getBoroughColor(borough)).lerp(_white, CONTEXT_LIGHTEN);
  contextColorCache.set(borough, c);
  return c;
}

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

// Pure helper: same height formula as the matrix loop, reused by the
// tooltip / selection anchor lookups so all three stay in sync.
function computeHeight(record, heightPerFloor) {
  const rawFloors = +record.numfloors;
  const floors = Math.min(
    Math.max(Number.isFinite(rawFloors) ? rawFloors : 1, 1),
    MAX_FLOORS
  );
  return Math.max(floors * heightPerFloor, MIN_HEIGHT);
}

function BuildingLayer({
  data,
  fullData = null,
  hoveredId = null,
  onHoverChange,
  selectedId = null,
  onSelect,
  worldSize = DEFAULT_WORLD_SIZE,
  heightPerFloor = DEFAULT_HEIGHT_PER_FLOOR,
  footprint = DEFAULT_FOOTPRINT,
  maxBuildings = DEFAULT_MAX_BUILDINGS,
}) {
  const meshRef = useRef(null);
  const contextMeshRef = useRef(null);

  // Step 1: filter + build a projector. Memoized on data identity so we
  // don't re-walk the array on unrelated re-renders.
  //
  // Projector uses the FIXED NYC extent (not the filtered data extent)
  // so building world positions are stable under filtering -- a
  // prerequisite for the bbox-fit camera in CityScene3D to mean anything.
  const computed = useMemo(() => {
    if (!data || data.length === 0) return null;

    let valid = data.filter(isValidRecord);
    if (valid.length > maxBuildings) valid = valid.slice(0, maxBuildings);
    if (valid.length === 0) return null;

    const project = createNYCProjector({ worldSize });

    return { valid, project };
  }, [data, worldSize, maxBuildings]);

  const count = computed?.valid.length ?? 0;

  // Context set: ALL valid records in fullData. Skipped when no filter
  // is active (fullData missing or same length as data) -- the focus
  // layer already covers everything in that case, so a duplicated
  // context layer would just waste draws.
  //
  // Note: this intentionally INCLUDES the focus buildings' positions.
  // The focus mesh sits on top at the same xz, fully occluding the
  // short context tile underneath, so visually there's no double-render.
  // Treating context as "all buildings" (not "filtered-out buildings")
  // keeps the mental model simple: context = city silhouette, always.
  const contextComputed = useMemo(() => {
    if (!fullData || fullData === data || fullData.length === data?.length) {
      return null;
    }

    let valid = fullData.filter(isValidRecord);
    if (valid.length === 0) return null;

    // Hard cap -- protects the GPU on the unfiltered city. With ~1M
    // PLUTO records the cap matters; the focus subset is its own mesh
    // so trimming context doesn't hide any focused building.
    if (valid.length > maxBuildings) valid = valid.slice(0, maxBuildings);

    const project = createNYCProjector({ worldSize });
    return { valid, project };
  }, [fullData, data, worldSize, maxBuildings]);

  const contextCount = contextComputed?.valid.length ?? 0;

  // Step 2: write per-instance matrices + colors imperatively.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !computed) return;

    const { valid, project } = computed;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < valid.length; i++) {
      const d = valid[i];
      const { x, z } = project(+d.longitude, +d.latitude);
      const height = computeHeight(d, heightPerFloor);

      dummy.position.set(x, height / 2, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(footprint, height, footprint);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      color.set(getBoroughColor(d.borough));
      mesh.setColorAt(i, color);
    }

    mesh.count = valid.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [computed, heightPerFloor, footprint]);

  // Context mesh matrices + per-instance colors. Same xz/footprint math
  // as the focus loop; height is forced flat and color is the lightened
  // version of the record's borough color so each tile stays in its own
  // hue family rather than collapsing into uniform grey.
  useLayoutEffect(() => {
    const mesh = contextMeshRef.current;
    if (!mesh || !contextComputed) return;

    const { valid, project } = contextComputed;
    const dummy = new THREE.Object3D();

    const h = CONTEXT_HEIGHT;
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i];
      const { x, z } = project(+d.longitude, +d.latitude);

      dummy.position.set(x, h / 2, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(footprint, h, footprint);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      mesh.setColorAt(i, getContextColor(d.borough));
    }

    mesh.count = valid.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [contextComputed, footprint]);

  // Pointer handlers -- read event.instanceId off the raycast hit and
  // bubble the new id up to the parent. stopPropagation so the ground
  // plane (or other meshes) don't also fire and clear the hover.
  const handlePointerMove = (event) => {
    if (!onHoverChange) return;
    event.stopPropagation();
    const id = event.instanceId;
    if (id == null) return;
    if (id !== hoveredId) onHoverChange(id);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = (event) => {
    if (!onHoverChange) return;
    event.stopPropagation();
    onHoverChange(null);
    document.body.style.cursor = '';
  };

  // Click selection: read instanceId off the raycast hit, look up the
  // record, hand both back to the parent. The parent owns the highlight
  // state AND the bridge to App-level filter state.
  const handleClick = (event) => {
    if (!onSelect || !computed) return;
    event.stopPropagation();
    const id = event.instanceId;
    if (id == null) return;
    const record = computed.valid[id];
    if (record) onSelect(record, id);
  };

  // Tooltip anchor: look up the hovered record + recompute its world
  // position. Stale ids (e.g. after a filter change) collapse to null.
  const hovered = useMemo(() => {
    if (hoveredId == null || !computed) return null;
    const record = computed.valid[hoveredId];
    if (!record) return null;
    const { x, z } = computed.project(+record.longitude, +record.latitude);
    const height = computeHeight(record, heightPerFloor);
    return {
      record,
      position: [x, height + TOOLTIP_Y_OFFSET, z],
    };
  }, [hoveredId, computed, heightPerFloor]);

  // Selection anchor: same pattern as the tooltip lookup but returns
  // the building's center + height so we can wrap it in a wireframe
  // box and drop a halo at its base. Stale ids collapse to null.
  const selected = useMemo(() => {
    if (selectedId == null || !computed) return null;
    const record = computed.valid[selectedId];
    if (!record) return null;
    const { x, z } = computed.project(+record.longitude, +record.latitude);
    const height = computeHeight(record, heightPerFloor);
    return {
      x,
      z,
      height,
      center: [x, height / 2, z],
    };
  }, [selectedId, computed, heightPerFloor]);

  if (count === 0 && contextCount === 0) return null;

  return (
    <>
      {/* CONTEXT layer (1 of 3): rendered first so it sits "behind" in
          the transparency sort. Click-through (raycast disabled) so it
          never steals events from the focus layer. */}
      {contextCount > 0 && (
        <instancedMesh
          key={`context:${contextCount}`}
          ref={contextMeshRef}
          args={[undefined, undefined, contextCount]}
          raycast={() => null}
        >
          <boxGeometry args={[1, 1, 1]} />
          {/* Material color stays white -- per-instance colors carry
              the lightened borough hue. Basic (unlit) reads as flat
              context, not dim focus. depthWrite off so context never
              punches holes in the depth buffer for focus buildings
              behind it; focus buildings in front still depth-test and
              correctly hide the context tile underneath them. */}
          <meshBasicMaterial
            transparent
            opacity={CONTEXT_OPACITY}
            depthWrite={false}
          />
        </instancedMesh>
      )}

      {/* FOCUS layer (2 of 3): full color, full height, lit + shadowed,
          interactive. The user's primary read. */}
      {count > 0 && (
        <instancedMesh
          // Force a fresh allocation when the instance count changes.
          // Simpler than managing a fixed-size buffer pool.
          key={count}
          ref={meshRef}
          args={[undefined, undefined, count]}
          castShadow
          receiveShadow
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <boxGeometry args={[1, 1, 1]} />
          {/* Slightly lower roughness + a hint of metalness gives focus
              buildings a touch more highlight energy than the matte
              unlit context, reinforcing the "built vs. backdrop" read
              without relying on an env map. */}
          <meshStandardMaterial roughness={0.78} metalness={0.06} />
        </instancedMesh>
      )}

      {/* SELECTION layer (3 of 3): three stacked cues, all click-through
          so they pass the next click straight to the focus mesh.
            a) Ground halo  -- floor spotlight, locks the eye from far.
            b) Emissive overlay at 1.05x -- the building itself grows
               slightly and glows in the accent color.
            c) Inflated shell at 1.10x (BackSide) -- thick colored rim
               around the building's silhouette.
          Stale ids collapse `selected` to null and the whole block
          unmounts. */}
      {selected && (() => {
        const overlayH = selected.height * SELECTION_OVERLAY_SCALE;
        const shellH = selected.height * SELECTION_SHELL_SCALE;
        return (
          <>
            <mesh
              position={[selected.x, SELECTION_HALO_THICKNESS / 2, selected.z]}
              scale={[
                footprint + SELECTION_HALO_PAD_XZ,
                SELECTION_HALO_THICKNESS,
                footprint + SELECTION_HALO_PAD_XZ,
              ]}
              raycast={() => null}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial
                color={SELECTION_COLOR}
                transparent
                opacity={0.55}
                depthWrite={false}
              />
            </mesh>

            {/* Emissive overlay. Centered so its base stays pinned at
                y = 0 (ground contact preserved under the upscale). */}
            <mesh
              position={[selected.x, overlayH / 2, selected.z]}
              scale={[
                footprint * SELECTION_OVERLAY_SCALE,
                overlayH,
                footprint * SELECTION_OVERLAY_SCALE,
              ]}
              raycast={() => null}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial
                color={SELECTION_COLOR}
                emissive={SELECTION_COLOR}
                emissiveIntensity={SELECTION_EMISSIVE_INTENSITY}
                transparent
                opacity={SELECTION_OVERLAY_OPACITY}
                depthWrite={false}
              />
            </mesh>

            {/* Inflated outline shell. depthWrite off so the overlay
                above + focus building below read cleanly; depthTest
                stays on so the shell is correctly occluded by nearer
                focus buildings (no "glow punches through city"). */}
            <mesh
              position={[selected.x, shellH / 2, selected.z]}
              scale={[
                footprint * SELECTION_SHELL_SCALE,
                shellH,
                footprint * SELECTION_SHELL_SCALE,
              ]}
              raycast={() => null}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial
                color={SELECTION_COLOR}
                side={THREE.BackSide}
                transparent
                opacity={SELECTION_SHELL_OPACITY}
                depthWrite={false}
              />
            </mesh>
          </>
        );
      })()}

      {hovered && (
        <BuildingTooltip
          record={hovered.record}
          position={hovered.position}
        />
      )}
    </>
  );
}

export default BuildingLayer;
