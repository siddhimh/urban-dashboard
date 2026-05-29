import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Text } from "@react-three/drei";
import { XR, useXR } from "@react-three/xr";
import SpatialBuildingLayer from "./spatial-building-layer";
import FootprintBuildingLayer from "./footprint-building-layer";
import BuildingTooltip from "./building-tooltip";
import SelectionPanel from "./selection-panel";
import {
  buildCluster,
  ClusterHalo,
  ClusterLabel,
} from "./cluster-controller";
import HumanScaleMode from "./human-scale-mode";
import { HeightProbeOverlay } from "./xr-tools";
import ScenarioGhostLayer from "./scenario-ghost-layer";
import {
  AR_MODEL_ROTATION_Y,
  AR_POSITION_INITIAL,
  AR_SCALE_INITIAL,
  AR_SCALE_MAX,
  AR_SCALE_MIN,
  HitTestReticle,
  XRDebugHUD,
  useXRThumbstickScale,
  useXRTwoHandPinchScale,
} from "./xr-interactions";
import {
  createProjection,
  derivePlatformSize,
  getGeoExtent,
  NYC_EXTENT,
} from "../../utils/projection";
import {
  fetchFootprintsForRecords,
  getCachedFootprint,
} from "../../utils/footprints";
import { buildLayerStats } from "../../utils/layer-stats";
import { buildMetricNormalizer } from "../../utils/spatial-colors";

// Visual size of the model on the desktop scene. WebXR shrinks the
// entire outer group to scale * WORLD_SIZE on its long axis, putting
// Manhattan on the user's tabletop (~0.3 m -> 1.5 m via gestures).
const WORLD_SIZE = 12;
const SPATIAL_MAX_BUILDINGS = 5000;

// Initial cluster brush radius in world units. The PDF wants a
// "cluster of nearby buildings" -- ~6% of WORLD_SIZE picks up a
// neighborhood-sized swath without overwhelming the platform.
export const DEFAULT_CLUSTER_RADIUS = 0.7;
export const CLUSTER_RADIUS_MIN = 0.2;
export const CLUSTER_RADIUS_MAX = 3.0;

function getRecordId(d, index) {
  return d.bbl || d.bin || d.id || index;
}

function BasePlatform({ width, depth }) {
  const outerW = width + 0.4;
  const outerD = depth + 0.4;
  return (
    <group position={[0, -0.08, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[outerW, 0.18, outerD]} />
        <meshStandardMaterial
          color="#07111f"
          roughness={0.82}
          metalness={0.18}
          transparent
          opacity={0.96}
        />
      </mesh>

      <mesh position={[0, 0.095, 0]} receiveShadow>
        <boxGeometry args={[width, 0.02, depth]} />
        <meshStandardMaterial
          color="#081624"
          roughness={0.92}
          metalness={0.08}
        />
      </mesh>

      <mesh position={[0, 0.112, 0]}>
        <boxGeometry args={[width + 0.3, 0.01, depth + 0.3]} />
        <meshBasicMaterial color="#39d5ff" transparent opacity={0.055} />
      </mesh>
    </group>
  );
}

// Rectangular grid sized to the platform. planeGeometry segments give
// us the wireframe; the divisions are tuned to keep cells roughly
// square regardless of the borough's aspect ratio.
function PlatformGrid({ width, depth }) {
  const segX = Math.max(4, Math.round(width * 1.2));
  const segZ = Math.max(4, Math.round(depth * 1.2));
  return (
    <mesh
      position={[0, 0.05, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[width, depth, segX, segZ]} />
      <meshBasicMaterial
        color="#123247"
        wireframe
        transparent
        opacity={0.55}
      />
    </mesh>
  );
}

function SceneLabels({ focusBorough = "Manhattan", width, depth }) {
  return (
    <group>
      <Text
        position={[-width / 2 + 0.15, 0.45, -depth / 2 - 0.15]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={Math.min(0.28, width * 0.08)}
        anchorX="left"
        anchorY="middle"
        color="#9eeaff"
      >
        {focusBorough.toUpperCase()} DIGITAL TWIN
      </Text>

      <Text
        position={[width / 2 - 1.4, 0.45, depth / 2 + 0.15]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={Math.min(0.18, width * 0.05)}
        anchorX="left"
        anchorY="middle"
        color="#6f8795"
      >
        BOROUGH → NEIGHBORHOOD → BUILDING
      </Text>
    </group>
  );
}

function getModelScale(scaleMode) {
  if (scaleMode === "building") return 1.25;
  if (scaleMode === "borough") return 1.08;
  return 0.95;
}

// Translucent ring on the platform under the selected building. Lives
// in the same local coord system as the building layers, so the model
// group's scale + position transforms it into world space.
function PlatformHaloRing({ position, radius = 0.32 }) {
  if (!position) return null;
  const inner = radius * 0.65;
  const outer = radius * 1.4;
  return (
    <mesh
      position={[position[0], 0.001, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <ringGeometry args={[inner, outer, 64]} />
      <meshBasicMaterial
        color="#39d5ff"
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function LevitatingCityScene({ xrStore, ...props }) {
  // Canvas + XR live at this outer boundary so that useXR (and all
  // session-aware logic) can run inside SceneContent.
  return (
    <Canvas
      shadows
      camera={{ position: [6.5, 6, 11], fov: 45 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => props.onClearSelection?.()}
    >
      {xrStore ? (
        <XR store={xrStore}>
          <SceneContent {...props} />
        </XR>
      ) : (
        <SceneContent {...props} />
      )}
    </Canvas>
  );
}

// Resets the camera to the tabletop overview pose when the user
// returns from human scale, so they don't land at PointerLock's last
// position (typically deep inside a tower).
function TabletopCameraReset({ viewMode }) {
  const { camera } = useThree();
  const last = useRef(viewMode);
  useEffect(() => {
    const prev = last.current;
    last.current = viewMode;
    if (viewMode === "tabletop" && prev !== "tabletop") {
      camera.position.set(6.5, 6, 11);
      camera.fov = 45;
      camera.near = 0.1;
      camera.far = 1000;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.5, 0);
    }
  }, [viewMode, camera]);
  return null;
}

function SceneContent({
  data = [],
  selectedId,
  selectedRecord,
  selectedCluster = null,
  onSelect,
  onClearSelection,
  onClusterChange,
  onClearCluster,
  viewMode = "tabletop",
  layerMode = "neutral",
  activeTool = "none",
  focusBorough = "Manhattan",
  placementMode = false,
  onPlaced,
  onReturnTabletop,
  onStatsChange,
  debugXR = true,
}) {
  const session = useXR((s) => s.session);
  const inXR = !!session;

  // Milestone 1: tabletop is the "city" scale we used to ship; human
  // scale is wired in Milestone 4. Keep the same overall sizing.
  const modelScale = useMemo(
    () => getModelScale(viewMode === "human" ? "building" : "city"),
    [viewMode]
  );

  // Source-of-truth AR scale. Driven by either the thumbstick or a
  // two-hand pinch gesture; both hooks write through the same ref so
  // they compose cleanly. The state mirror exists so React can re-
  // render the group's `scale` prop when the value moves.
  const arScaleRef = useRef(AR_SCALE_INITIAL);
  const [arScale, setArScale] = useState(AR_SCALE_INITIAL);

  // AR placement anchor. Starts in front of the user; `Place` mode +
  // the hit-test reticle move it onto a real surface.
  const [arPosition, setArPosition] = useState(AR_POSITION_INITIAL);

  // Reset scale + position every time a new XR session starts. Without
  // this, a user who shrunk the model last session would re-enter at
  // the tiny size and report "AR is broken".
  useEffect(() => {
    if (inXR) {
      arScaleRef.current = AR_SCALE_INITIAL;
      setArScale(AR_SCALE_INITIAL);
      setArPosition(AR_POSITION_INITIAL);
    }
  }, [inXR]);

  // Track the last XR pointer event so the debug HUD can show "the
  // ray hit a building" or "the click reached the canvas".
  const [lastXREvent, setLastXREvent] = useState(null);

  useXRThumbstickScale({
    scaleRef: arScaleRef,
    setScale: setArScale,
    enabled: inXR,
    min: AR_SCALE_MIN,
    max: AR_SCALE_MAX,
  });

  useXRTwoHandPinchScale({
    scaleRef: arScaleRef,
    setScale: setArScale,
    enabled: inXR,
    min: AR_SCALE_MIN,
    max: AR_SCALE_MAX,
  });

  // Hit-test reticle commits a new anchor; the parent toolbar is
  // responsible for exiting placement mode (so the user can chain
  // multiple repositions if they re-enter it).
  const handlePlaced = useCallback(
    (hit) => {
      if (!hit?.position) return;
      setArPosition(hit.position);
      onPlaced?.(hit);
    },
    [onPlaced]
  );

  // Single computation of extent + projector + platform dims. Children
  // all read from this same projector so boxes and footprints share a
  // coordinate system. Declared early because handleSelect closes over
  // `project` -- the useCallback dep array reads it synchronously.
  const { project, dims } = useMemo(() => {
    const extent = getGeoExtent(data) ?? NYC_EXTENT;
    const projector = createProjection(extent, { worldSize: WORLD_SIZE });
    const d = derivePlatformSize(extent, WORLD_SIZE);
    return { project: projector, dims: d };
  }, [data]);

  // Per-dataset layer statistics + active layer normalizer. Computed
  // once per data change; the normalizer changes when layerMode flips.
  const stats = useMemo(() => buildLayerStats(data), [data]);
  const normalizer = useMemo(
    () => buildMetricNormalizer(layerMode, stats),
    [layerMode, stats]
  );
  useEffect(() => {
    onStatsChange?.(stats);
  }, [stats, onStatsChange]);

  // Cluster id set: O(1) "is this building part of the active cluster"
  // lookup for the layer renderers. Lifted into useMemo so the layers
  // can use it as a dependency without recreating Sets on every render.
  const clusterIds = useMemo(() => {
    if (!selectedCluster?.ids?.length) return null;
    return new Set(selectedCluster.ids);
  }, [selectedCluster]);

  // Scene-local hover state. We track full anchor info (record + 3D
  // position) so the tooltip + ring can be placed without round-
  // tripping that data through SpatialTwinView.
  const [hoveredAnchor, setHoveredAnchor] = useState(null);
  const [selectedAnchor, setSelectedAnchor] = useState(null);

  // Layers fire { id, record, pos, base, footprint } -- the layer
  // already has all of that in hand. The scene normalizes the
  // contract for downstream consumers (SpatialTwinView wants the
  // record + id; the tooltip + ring read pos / footprint locally).
  const handleHover = useCallback((anchor) => {
    setHoveredAnchor(anchor ?? null);
  }, []);

  const handleSelect = useCallback(
    (anchor) => {
      if (!anchor) return;
      setSelectedAnchor(anchor);
      setLastXREvent(
        `select ${String(anchor.id).slice(0, 8)} @ ${new Date()
          .toISOString()
          .slice(11, 19)}`
      );

      // Shift-click -> cluster brush pick. Build a new cluster
      // anchored on this building using the active radius (or the
      // default if no cluster exists yet).
      if (anchor.shiftKey && onClusterChange) {
        const prevRadius = selectedCluster?.radius ?? DEFAULT_CLUSTER_RADIUS;
        const next = buildCluster({
          data,
          project,
          centerRecord: anchor.record,
          centerIndex: anchor.index ?? -1,
          radius: prevRadius,
        });
        if (next) {
          onClusterChange(next);
        }
        return;
      }

      onSelect?.(anchor.record, anchor.id);
    },
    [data, project, selectedCluster, onClusterChange, onSelect]
  );

  // SpatialTwinView's "clear selection" button (and the canvas's
  // onPointerMissed handler) both drive the parent's selectedId to
  // null; we mirror that into the scene's local selectedAnchor so the
  // ring and the cyan footprint mesh disappear together.
  useEffect(() => {
    if (selectedId == null) {
      setSelectedAnchor(null);
    }
  }, [selectedId]);

  // Pull hovered/selected ids out of the anchors so the layers know
  // which instance to recolor. The anchor objects also carry the
  // position the tooltip / ring need.
  const hoveredId = hoveredAnchor?.id ?? null;
  const localSelectedId = selectedAnchor?.id ?? selectedId ?? null;

  // Phase 2: stream real building footprints in. Keys are the original
  // index in `data` (per the contract of fetchFootprintsForRecords).
  // We rebuild a partial Map on every batch by walking the fetcher's
  // record cache so the scene shows a gradual box -> footprint flip
  // instead of one big swap when the whole job resolves.
  const [footprintsByIndex, setFootprintsByIndex] = useState(() => new Map());
  const lastProgressRef = useRef(0);

  useEffect(() => {
    setFootprintsByIndex(new Map());
    lastProgressRef.current = 0;
    if (!data || data.length === 0) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    const buildPartialMap = () => {
      const partial = new Map();
      for (let i = 0; i < data.length; i++) {
        const fp = getCachedFootprint(data[i]);
        if (fp) partial.set(i, fp);
      }
      return partial;
    };

    fetchFootprintsForRecords(data, {
      signal: controller.signal,
      onProgress: () => {
        if (cancelled) return;
        // Throttle: rebuilding + re-merging geometry on every batch
        // (~334 batches for 5000 records) would tank the frame rate.
        const now = performance.now();
        if (now - lastProgressRef.current < 250) return;
        lastProgressRef.current = now;
        setFootprintsByIndex(buildPartialMap());
      },
    }).then((results) => {
      if (cancelled) return;
      // Final commit ensures the last batch is reflected even if it
      // landed inside the throttle window.
      setFootprintsByIndex(new Map(results));
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [data]);

  // Records whose footprint hasn't (yet) resolved -- those stay on
  // the instant box renderer. Records whose footprint did resolve
  // get upgraded to real extruded polygons.
  const { boxData, footprintEntries } = useMemo(() => {
    const boxes = [];
    const fps = [];
    data.forEach((rec, i) => {
      const fp = footprintsByIndex.get(i);
      if (fp && fp.geometry) {
        fps.push({
          record: rec,
          id: getRecordId(rec, i),
          geometry: fp.geometry,
          heightRoof: fp.heightRoof,
        });
      } else {
        boxes.push(rec);
      }
    });
    return { boxData: boxes, footprintEntries: fps };
  }, [data, footprintsByIndex]);

  const isTabletop = viewMode !== "human";
  const isHuman = viewMode === "human";

  // In AR, drop the solid scene background + atmospheric fog so the
  // camera passthrough is visible. On desktop they restore the inky
  // void around the levitating plinth.
  return (
    <>
      {!inXR && isTabletop && <color attach="background" args={["#030711"]} />}
      {!inXR && isTabletop && <fog attach="fog" args={["#030711", 16, 36]} />}

      {isTabletop && (
        <>
          <ambientLight intensity={0.45} />
          <hemisphereLight args={["#a8dfff", "#05070c", 0.9]} />
          <directionalLight
            position={[6, 10, 5]}
            intensity={1.5}
            castShadow={!inXR}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <pointLight position={[-6, 4, -4]} intensity={0.8} color="#39d5ff" />
        </>
      )}

      {/* Surface-placement reticle: lives outside the BoroughTwin
          group so its world-space position is independent of the
          model's transform. The Place button in the AR banner toggles
          `placementMode`; once visible, the reticle tracks the nearest
          plane in front of the user and waits for a select. */}
      {inXR && placementMode && (
        <HitTestReticle visible onPlace={handlePlaced} />
      )}

      {/* In-headset debug HUD: shows whether hands / controllers are
          detected and whether selects are reaching us. Toggleable via
          the `debugXR` prop. */}
      {inXR && debugXR && (
        <XRDebugHUD scale={arScale} lastEvent={lastXREvent} enabled />
      )}

      {/* AR-aware wrapper: in AR, shrink the whole BoroughTwin onto
          a tabletop, rotate so the long edge reads horizontally, and
          float it in front of the user. */}
      <group
        visible={isTabletop}
        position={inXR ? arPosition : [0, 0, 0]}
        rotation={inXR ? [0, AR_MODEL_ROTATION_Y, 0] : [0, 0, 0]}
        scale={inXR ? [arScale, arScale, arScale] : [1, 1, 1]}
      >
        <BasePlatform
          width={dims.platformWidth}
          depth={dims.platformDepth}
        />
        <PlatformGrid
          width={dims.platformWidth}
          depth={dims.platformDepth}
        />
        <SceneLabels
          focusBorough={focusBorough}
          width={dims.platformWidth}
          depth={dims.platformDepth}
        />

        {/* Buildings sit on the platform top surface (y ≈ 0.025) so
            there's no visible air gap between base and plinth. */}
        <group
          position={[0, 0.03, 0]}
          scale={[modelScale, 1, modelScale]}
        >
          <SpatialBuildingLayer
            data={boxData}
            project={project}
            hoveredId={hoveredId}
            selectedId={localSelectedId}
            onHoverChange={handleHover}
            onSelect={handleSelect}
            maxBuildings={SPATIAL_MAX_BUILDINGS}
            layerMode={layerMode}
            normalizer={normalizer}
            clusterIds={clusterIds}
          />
          <FootprintBuildingLayer
            entries={footprintEntries}
            project={project}
            hoveredId={hoveredId}
            selectedId={localSelectedId}
            onHoverChange={handleHover}
            onSelect={handleSelect}
            layerMode={layerMode}
            normalizer={normalizer}
            clusterIds={clusterIds}
          />

          {/* Hover tooltip. On desktop the default <Html> overlay
              composites with the page DOM; in XR we switch to
              `transform` mode so the headset compositor renders it
              as a sprite in the scene. */}
          {hoveredAnchor && (
            <BuildingTooltip
              record={hoveredAnchor.record}
              position={hoveredAnchor.pos}
              transform={inXR}
            />
          )}

          {selectedAnchor && !selectedCluster && (
            <PlatformHaloRing
              position={selectedAnchor.base}
              radius={selectedAnchor.footprint}
            />
          )}

          {selectedCluster && (
            <>
              <ClusterHalo cluster={selectedCluster} />
              <ClusterLabel cluster={selectedCluster} detailed={inXR} />
            </>
          )}

          {isTabletop && activeTool === "heightProbe" && (
            <HeightProbeOverlay
              active
              anchor={selectedAnchor}
              stats={stats}
              mode="tabletop"
            />
          )}

          {isTabletop && (
            <ScenarioGhostLayer
              project={project}
              entries={footprintEntries}
            />
          )}

          {/* XR selection card. Lives inside the model group so it
              scales + moves with the platform, but uses <Html sprite>
              to billboard the panel toward the viewer. Hidden on
              desktop -- the DOM-side SelectionPanel handles that.
              `distanceFactor` is small here because the whole outer
              group is scaled by ~0.12 in AR; without compensation
              the card would be a ~2 m floating wall. */}
          {inXR && selectedAnchor && (selectedRecord || selectedAnchor.record) && (
            <Html
              position={[
                selectedAnchor.pos[0],
                selectedAnchor.pos[1] + 3,
                selectedAnchor.pos[2],
              ]}
              transform
              sprite
              distanceFactor={1.5}
              wrapperClass="spatial-xr-card-wrapper"
            >
              <SelectionPanel
                record={selectedRecord ?? selectedAnchor.record}
                selectedId={localSelectedId}
                onClear={onClearSelection}
              />
            </Html>
          )}
        </group>
      </group>

      <TabletopCameraReset viewMode={viewMode} />

      {isHuman && (
        <>
          <HumanScaleMode
            cluster={selectedCluster}
            layerMode={layerMode}
            normalizer={normalizer}
            footprintEntries={footprintEntries}
            enabled={isHuman}
            inXR={inXR}
            hoveredId={hoveredId}
            selectedId={localSelectedId}
            onHoverBuilding={handleHover}
            onSelectBuilding={(anchor) => handleSelect(anchor)}
          />
          {activeTool === "heightProbe" && (
            <HeightProbeOverlay
              active
              anchor={selectedAnchor}
              stats={stats}
              mode="human"
            />
          )}
        </>
      )}

      {/* Camera control is owned by OrbitControls on desktop and by
          the headset / device pose in AR. We unmount OrbitControls in
          human mode so PointerLockControls (registered by
          HumanScaleMode via makeDefault) can take over without two
          rigs fighting for the camera. */}
      {isTabletop && (
        <OrbitControls
          makeDefault
          enabled={!inXR}
          enableDamping
          dampingFactor={0.08}
          minDistance={3}
          maxDistance={28}
          maxPolarAngle={Math.PI * 0.48}
          target={[0, 0.5, 0]}
        />
      )}
    </>
  );
}

export default LevitatingCityScene;
