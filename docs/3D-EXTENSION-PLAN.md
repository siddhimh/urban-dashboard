# 3D Extension Plan — Urban Morphology Dashboard

> Planning + progress document for adding a React Three Fiber + Three.js 3D
> view as an incremental extension of the existing React + D3 2D dashboard.
>
> **Constraint:** all existing 2D views, interactions, and shared filtering
> state in `App.js` remain unchanged. The 3D view is purely additive.

---

## Status (verified against current code)

### Completed

- [x] **Packages installed** — `three@^0.184.0`, `@react-three/fiber@^8.17.10`,
      `@react-three/drei@^9.120.3` (see `package.json`).
- [x] **Folder structure scaffolded** — `src/components/three/` and
      `src/utils/` exist with all planned filenames.
- [x] **2D / 3D toggle in TopBar** — segmented control in
      `src/components/layout/topbar.js`, driven by `activeView` /
      `setActiveView` props.
- [x] **`viewMode` wired through App → Dashboard → TopBar** — `App.js` owns
      `activeView` state (default `'2D'`); the value is passed to both
      `DashboardLayout` (which forwards it to `TopBar`) and to the 3D branch.
- [x] **3D branch in App.js** — when `activeView === '3D'`, `App.js` renders
      `<TopBar />` + `<CityView3D data={filteredData} />`, sharing the same
      filter pipeline as the 2D dashboard.
- [x] **Empty 3D canvas mounted** — `CityView3D` → `CityScene3D` sets up the
      `<Canvas>` (perspective camera, shadows enabled), ambient + directional
      shadow-casting light, `CameraRig` (OrbitControls with distance + polar
      clamp), and `GroundPlane`.
- [x] **Shared projection utility** — `src/utils/projection.js` implements
      `getGeoExtent`, `createProjection`, and `projectorFromData` with an
      equirectangular cos(lat) correction and aspect-preserving fit.
- [x] **Shared color utility (borough palette)** — `src/utils/building-color.js`
      adapts `src/colors.js` (`BOROUGH_PALETTE`, `BOROUGH_ORDER`,
      `BOROUGH_NAMES`) into `getBoroughColor` / `getBuildingColor` and a
      neutral fallback.
- [x] **Buildings rendered from filtered data** — `BuildingLayer` is a single
      `InstancedMesh` of unit cubes:
  - NYC bbox filter mirrors the 2D DotMap.
  - Hard cap of `maxBuildings = 20000` to protect the GPU.
  - Per-instance position via `projectorFromData`, scale via `numfloors`
    (clamped 1..120, `MIN_HEIGHT = 0.6`, `heightPerFloor = 1.2`), color via
    `getBoroughColor`.
  - Matrices + colors written in a `useLayoutEffect` so there is no
    one-frame flash of unscaled cubes.
  - `key={count}` re-allocates the mesh whenever instance count changes.
  - `computeBoundingSphere()` called so frustum culling works.

### Not yet done

- [ ] **Step 6 — Hover tooltip + selection.** `src/components/three/building-tooltip.js`
      is currently an empty file; no raycasting / hover state in
      `BuildingLayer` yet.
- [ ] **Step 7 — Annotations + legend.** `borough-labels3d.js` and
      `legend-3d.js` are empty files; nothing is rendered for either yet.
- [ ] **Step 8 — Code-split the 3D bundle.** `CityView3D` is currently a
      static `import` in `App.js`; needs to become `React.lazy` +
      `<Suspense>` so 2D-only sessions don't pay the Three.js cost.
- [ ] **Metric-based color scale (deferred from Step 4).** `building-color.js`
      only exposes the borough palette. A continuous metric → color helper
      (e.g. floors or building area) is not implemented yet; needed if
      `BuildingLayer` or the 3D legend should color by metric instead of
      borough.
- [ ] **Step 9 — Polish (optional).** Camera presets per borough, smooth
      transitions, post-processing — pending explicit go-ahead.

---

## 1. Folder Structure

Only additive. Nothing in the existing 2D tree is moved or renamed.

```text
src/
├── App.js                         # extended: activeView state + 3D branch
├── components/
│   ├── layout/
│   │   ├── dashboard.js           # extended: forwards activeView/setActiveView to TopBar
│   │   ├── topbar.js              # extended: 2D/3D segmented toggle
│   │   └── city-view3d.js         # DONE: container/wrapper for the 3D view
│   │
│   ├── three/                     # all R3F/Three.js code lives here
│   │   ├── city-scene3d.js        # DONE: <Canvas> root + lights + scene
│   │   ├── camera-rig.js          # DONE: OrbitControls with distance/polar clamp
│   │   ├── ground-plane.js        # DONE: shadow-receiving base plane
│   │   ├── building-layer.js      # DONE: InstancedMesh of buildings
│   │   ├── building-tooltip.js    # PENDING (file exists, empty)
│   │   ├── borough-labels3d.js    # PENDING (file exists, empty)
│   │   └── legend-3d.js           # PENDING (file exists, empty)
│   │
│   └── (all existing 2D components untouched)
│
└── utils/
    ├── projection.js              # DONE: lon/lat → scene x/z
    └── building-color.js          # DONE for borough; metric scale PENDING
```

### Rationale

- `components/three/` is a **hard boundary**. Anything importing `three` or
  `@react-three/fiber` lives only in here. The 2D D3 code never imports Three.
- `components/layout/city-view3d.js` is the **only bridge** between layout and
  the 3D subtree, so the rest of the app keeps treating "the view" as a single
  slot.
- `utils/projection.js` and `utils/building-color.js` are **pure functions**
  usable by both 2D and 3D, so legends and colors stay consistent.

---

## 2. Component Structure

### Tree (status annotated)

```text
<App>                                       extended (activeView)
├── activeView === "2D" → <DashboardLayout> unchanged
│   └── <TopBar viewMode toggle/>           extended
│
└── activeView === "3D" →
    ├── <TopBar viewMode toggle/>           extended
    └── <CityView3D data={filteredData}>    DONE
        └── <CityScene3D>                   DONE
            ├── <CameraRig />                DONE
            ├── <GroundPlane />              DONE
            ├── <BuildingLayer />            DONE
            ├── <BoroughLabels3D />          PENDING
            └── <Html> overlays:
                  ├── <BuildingTooltip />    PENDING
                  └── <Legend3D /> (DOM)     PENDING
```

### Responsibilities

| Component          | Status   | Responsibility                                                                                                  |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| `CityView3D`       | DONE     | Layout wrapper; sizes the canvas (`calc(100vh - 60px)`); receives `data` via props.                             |
| `CityScene3D`      | DONE     | Pure scene composition; `<Canvas>` + lights + composes `CameraRig` / `GroundPlane` / `BuildingLayer`.            |
| `CameraRig`        | DONE     | OrbitControls with `minDistance` 20, `maxDistance` 400, polar clamp at `π/2.05`.                                 |
| `GroundPlane`      | DONE     | 400×400 shadow-receiving plane.                                                                                  |
| `BuildingLayer`    | DONE     | `InstancedMesh` of unit cubes; per-instance transform + color from `projection.js` + `building-color.js`.        |
| `BuildingTooltip`  | PENDING  | Will use drei `<Html>`; reads hovered id from `CityView3D`.                                                      |
| `BoroughLabels3D`  | PENDING  | Borough-level annotations (text or sprites).                                                                     |
| `Legend3D`         | PENDING  | DOM legend rendered as a sibling of `<Canvas>` (not inside it), reusing the 2D color scale.                      |

### Hard rules

- No 3D component reads global state directly. Everything flows in via props
  from `CityView3D`. _(Currently honored.)_
- No D3 inside `components/three/`. No Three inside any 2D component.
  _(Currently honored.)_

---

## 3. State / Data Flow Plan

**Principle:** the existing `App.js` shared filtering state is the single
source of truth. The 3D view is just another consumer of the same filtered
dataset.

### Implemented in `App.js`

- `const [activeView, setActiveView] = useState('2D');`
- Passed to `TopBar` (via both branches) and to `DashboardLayout`.
- 3D branch renders `<CityView3D data={filteredData} />`, so the 3D scene
  reacts to:
  - `selectedBoroughs`
  - `selectedLandUse`
  - `selectedZoning`
  - `brushRange` (year range)
  …without any new global state.

### Data flow (top → down)

```text
App.js
  ├─ filters (existing)        ──┐
  ├─ filteredData (existing)   ──┤
  └─ activeView (DONE)         ──┤
                                 ▼
                          activeView === "2D" ?
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
     <DashboardLayout/>                          <CityView3D data={filteredData}/>
     (unchanged 2D views)                          │
                                                   ▼
                                              <CityScene3D data={…}/>
                                                   │
                                                   ▼
                                              <BuildingLayer data={…}/>
```

### Event flow (bottom → up) — pending

- Hover/click in `BuildingLayer` will set local `hoveredId` / `selectedId` in
  `CityView3D` (Step 6).
- A selection that should affect global filters (e.g., "filter by borough X")
  will call the **same setters** `App.js` already exposes to the 2D view.
  No new global state machine.

### Cross-view consistency

- **Borough color:** both 2D (via `src/colors.js`) and 3D (via
  `utils/building-color.js`, which re-exports from `colors.js`) are aligned.
- **Coordinate mapping:** 3D uses `utils/projection.js`. 2D `DotMap` still
  uses its own internal projection; intentionally **not** refactored yet, to
  keep this change set additive.
- **Filters:** same object, same shape, both views.

### Performance guardrails — current state

- `BuildingLayer` uses a single `InstancedMesh` (one draw call). ✅
- `useMemo` on `data` identity for the projector + valid set. ✅
- `useLayoutEffect` for matrix/color writes (avoids first-frame flash). ✅
- Hard cap `maxBuildings = 20000`. ✅
- Lazy-loading the 3D bundle is **not yet** done (Step 8). ❌

---

## 4. Step-by-Step Implementation Order — Progress

### Step 1 — Setup ✅ DONE

- Installed `three`, `@react-three/fiber`, `@react-three/drei`.
- Created files in `components/three/` and `utils/`.
- Added "3D View" toggle button in `topbar.js`.

### Step 2 — Wire `activeView` through App → Dashboard → TopBar ✅ DONE

- `activeView` state in `App.js`.
- Passed to `DashboardLayout` (which forwards to `TopBar`) and to the 3D
  branch.
- Toggle swaps to the 3D view; 2D remains pixel-identical.

### Step 3 — Mount an empty 3D canvas ✅ DONE

- `CityView3D` + `CityScene3D` with `<Canvas>`, `CameraRig`, `GroundPlane`,
  ambient + directional lights.
- Orbiting an empty plane works in the 3D tab (with shadows enabled).

### Step 4 — Shared utilities ✅ DONE (borough) / ⚠ PARTIAL (metric scale)

- `utils/projection.js` — fully implemented with `getGeoExtent`,
  `createProjection`, `projectorFromData`.
- `utils/building-color.js` — borough palette adapter is in. **Metric →
  color scale (e.g. by floors / area) is not implemented yet** and is needed
  before Step 7's legend can color by metric.

### Step 5 — Render buildings from filtered data ✅ DONE

- `BuildingLayer` driven by `filteredData`. Heights from `numfloors`,
  positions from `projectorFromData`, colors from `getBoroughColor`.
- Changing any sidebar filter updates the 3D scene in lockstep with the 2D
  view.

### Step 6 — Hover tooltip + selection ❌ PENDING

- `building-tooltip.js` exists but is empty.
- Need to:
  - Add `hoveredId` / `hoveredRecord` state in `CityView3D`.
  - Add `onPointerMove` / `onPointerOut` handlers on `BuildingLayer`'s
    `<instancedMesh>` to read `event.instanceId` and look up the record.
  - Render `<BuildingTooltip>` via drei `<Html>`, anchored at the hovered
    instance position.
  - (Optional) emit click → existing selection setter.
- **Acceptance:** hovering a building shows its info; the 2D filter pipeline
  is unaffected unless we explicitly wire selection.

### Step 7 — Annotations + legend ❌ PENDING

- `borough-labels3d.js` and `legend-3d.js` are empty.
- Need to:
  - `BoroughLabels3D`: place borough name labels at borough centroids (use
    `BOROUGH_NAMES` + a centroid computation over `filteredData`).
  - `Legend3D`: DOM legend rendered as a sibling of `<Canvas>` inside
    `CityView3D` (not inside the canvas). Reuse the same swatches as the 2D
    dashboard for visual parity.
- **Acceptance:** legends in 2D and 3D are visually identical.

### Step 8 — Code-split the 3D bundle ❌ PENDING

- Currently `App.js` does a static `import CityView3D from
  "./components/layout/city-view3d";`.
- Convert to `const CityView3D = React.lazy(() => import('./components/layout/city-view3d'))`
  and wrap with `<Suspense fallback={…} />` inside the 3D branch.
- **Acceptance:** 2D-only sessions don't download Three.js (verify in the
  network tab / `npm run build` chunk report).

### Step 9 — Polish (optional) ❌ PENDING

- Camera presets per borough, smooth transitions, post-processing — only
  if explicitly requested.

---

## What's remaining (concise)

1. **Step 6** — implement `building-tooltip.js` + add hover state & raycast in `BuildingLayer`.
2. **Step 7** — implement `borough-labels3d.js` + `legend-3d.js`.
3. **Step 4 follow-up** — add a metric → color scale helper in `building-color.js` (only if 3D should color by metric instead of borough).
4. **Step 8** — convert `CityView3D` import in `App.js` to `React.lazy` + `<Suspense>`.
5. **Step 9** — optional polish (camera presets, transitions, shadows tuning, post-processing).

---

## Phase 2 — Digital-Twin Geometry (IN PROGRESS)

The generic 170 m × 170 m extruded box used for every PLUTO record reads
as "something exists here" but flattens the actual city silhouette. This
phase replaces those cubes with **real building polygons** from the NYC
Open Data planimetric "BUILDING" dataset (`5zhs-2jue`), extruded to their
true `height_roof`.

**Scope (intentionally narrow).** The Mapbox-backed scene
(`city-scene-mapbox.js`) is the active 3D view in the app today, so this
phase lands there. The R3F scene (`city-scene3d.js`) is untouched and
remains available as a parallel code path.

### New files

| File                                               | Role                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/footprints.js`                          | Fetches footprint polygons + `heightroof` from NYC Open Data via batched `within_circle` queries. In-memory + sessionStorage cache. |
| `src/components/three/footprint-mesh.js`           | Converts polygons (+ heights) into a **single merged** `THREE.BufferGeometry` (one draw call) with per-building vertex ranges for hover/select recoloring. |

### Modified file

- `src/components/three/city-scene-mapbox.js`
  - New imports from the two files above.
  - New fetch `useEffect`: resolves footprints for the current filtered
    dataset and bumps `footprintVersion` when the cache grows.
  - Build pass now **partitions** `valid` into
    - footprint-matched → extruded merged mesh
    - unmatched → original instanced-cube mesh (fallback)
  - Hover writer routes color updates to whichever mesh owns the
    `valid`-index. `boxIdByValid` tracks the valid-index ↔ InstancedMesh
    instance-id mapping for the box subset.
  - Selection halo/overlay/shell now read `heightMerc` from the
    footprint range when present, keeping the highlight correctly
    scaled to the real building height.

### Design rules (must hold)

- **Fallback is automatic, not configured.** If the footprint fetch
  fails or is still in flight, the record stays on the box renderer.
  The user always sees something at every valid lat/lng.
- **No change to the data contract.** `data`, `fullData`, `selectedId`,
  `onSelect`, `onHoverChange`, `activePreset` props all behave exactly
  as before. `App.js` / `CityView3D` need zero changes.
- **Picking stays screen-space.** We keep the existing `pick(point)`
  algorithm (pixel-radius nearest lat/lng) because it's borough-count
  independent and doesn't care which mesh a building lives in.
- **One draw call per layer.** Footprints merge into a single mesh so
  we stay on the same perf envelope as `MAX_BUILDINGS = 20000`
  instanced cubes.
- **Feature flag.** `USE_FOOTPRINTS` in `city-scene-mapbox.js` can be
  flipped to `false` to force the legacy cubes everywhere — useful for
  A/B-ing visual regressions without reverting code.

### Status

- [x] Footprint fetch utility with batching + cache
- [x] Merged extruded-geometry builder
- [x] Integration into Mapbox scene with box fallback
- [x] Hover / click / selection routed across both meshes
- [x] Selection highlight sized to real footprint height
- [x] Progressive upgrade (re-render batch-by-batch during fetch). The
      fetch effect bumps `footprintVersion` at most every 1.5 s while
      batches are still in flight, so boxes swap to real polygons in
      visible waves.
- [ ] Selection halo / shell shaped to the actual footprint polygon
      (currently still the old box shape, just height-matched). Cheap
      follow-up via another `ExtrudeGeometry` on the selected ring.
- [ ] Local pre-bundled footprints for fully offline first paint.
      Today every new record set hits the NYC Open Data API on cold
      start (cached in sessionStorage afterwards).

### Bug fixed in this revision

Initial drafts pointed the Socrata fetcher at dataset id `nqwf-w8eh`,
which doesn't exist on NYC Open Data -- every request returned
`dataset.missing` and every record fell back to the box renderer,
masking the new layer entirely. Corrected to `5zhs-2jue` with the
snake-cased column names (`height_roof`, `ground_elevation`, `bin`,
`base_bbl`). Cache key version bumped from `v1` to `v2` so stale
misses from the broken id don't poison the new fetcher.

---

## Notes

- This document is **planning + progress**. No new implementation code is
  included.
- Recommended next step: **Step 6 (hover tooltip)** — smallest, most visible
  improvement and unblocks a lot of later UX (selection, "fly to" presets).
- Any deviation from this plan (new global state, importing Three outside
  `components/three/`, or modifying existing 2D components) should be flagged
  before being made.
