import { useCallback, useEffect, useMemo, useState } from "react";
import { createXRStore } from "@react-three/xr";
import LevitatingCityScene, {
  CLUSTER_RADIUS_MAX,
  CLUSTER_RADIUS_MIN,
  DEFAULT_CLUSTER_RADIUS,
} from "../three/levitating-scene";
import SelectionPanel from "../three/selection-panel";
import LayerLegend from "../three/layer-legend";
import ClusterSummaryPanel from "../three/cluster-summary-panel";
import { ToolPicker, TOOL_DEFS } from "../three/xr-tools";
import GuidedWalkthrough from "../three/guided-walkthrough";
import { MANHATTAN_STOPS } from "../three/walkthrough-data";
import {
  buildCluster,
  recomputeCluster,
} from "../three/cluster-controller";
import { createProjection, getGeoExtent, NYC_EXTENT } from "../../utils/projection";
import "./spatial-twin.css";

const VIEW_WORLD_SIZE = 12;

// Single module-scope XR store. Creating it at module scope (instead
// of inside the component) keeps it stable across re-renders and lets
// us bind `xrStore.subscribe` outside of <Canvas>, which is necessary
// because useXR() only works inside the XR React tree.
const xrStore = createXRStore({
  hand: true,
  controller: true,
  emulate: false,
});

// React hook that mirrors xrStore.mode into component state so the
// shell can hide DOM overlays / swap the "Enter AR" button while a
// session is active.
function useXRMode() {
  const [mode, setMode] = useState(() => xrStore.getState().mode);
  useEffect(() => {
    return xrStore.subscribe((state) => {
      setMode(state.mode);
    });
  }, []);
  return mode;
}

// WebXR only exists on secure origins (HTTPS or localhost). Quest
// Browser loading http://10.x.x.x:3000 will never expose navigator.xr,
// so isSessionSupported never runs and the button stays hidden.
function useXRCapability() {
  const [capability, setCapability] = useState({
    status: "checking",
    mode: null,
    secure: typeof window !== "undefined" ? window.isSecureContext : false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const secure = window.isSecureContext;
    if (!secure) {
      setCapability({ status: "insecure", mode: null, secure: false });
      return;
    }

    if (!navigator.xr) {
      setCapability({ status: "unsupported", mode: null, secure: true });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const ar = await navigator.xr.isSessionSupported("immersive-ar");
        if (cancelled) return;
        if (ar) {
          setCapability({ status: "ready", mode: "immersive-ar", secure: true });
          return;
        }

        const vr = await navigator.xr.isSessionSupported("immersive-vr");
        if (cancelled) return;
        if (vr) {
          setCapability({ status: "ready", mode: "immersive-vr", secure: true });
          return;
        }

        setCapability({ status: "unsupported", mode: null, secure: true });
      } catch {
        if (!cancelled) {
          setCapability({ status: "unsupported", mode: null, secure: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return capability;
}

// Layer modes drive the building color scale. Neutral keeps the
// borough palette; Height / Density build a metric color ramp from
// the dataset. Age + Land Use are scaffolded for later (Milestone 7).
export const LAYER_MODES = [
  { id: "neutral", label: "Neutral" },
  { id: "height", label: "Height" },
  { id: "density", label: "Density" },
];

// View modes: the PDF's signature scale-transition lives here. Human
// Scale is only enabled once the user has picked an area on the
// tabletop (a single building or a cluster brushed in Milestone 3).
export const VIEW_MODES = [
  { id: "tabletop", label: "Tabletop" },
  { id: "human", label: "Human Scale" },
];

function SpatialTwinView({ data = [], focusBorough = "Manhattan" }) {
  const [selectedId, setSelectedId] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [viewMode, setViewMode] = useState("tabletop");
  const [layerMode, setLayerMode] = useState("neutral");
  const [activeTool, setActiveTool] = useState("none");
  const [placementMode, setPlacementMode] = useState(false);
  const [layerStats, setLayerStats] = useState(null);
  const xrCapability = useXRCapability();

  const xrMode = useXRMode();
  const inXR = xrMode != null;
  const canEnterXR = xrCapability.status === "ready" && xrCapability.mode;
  const enterLabel =
    xrCapability.mode === "immersive-vr" ? "Enter VR" : "Enter AR";

  // Reset selection whenever the dataset changes (e.g. borough swap).
  useEffect(() => {
    setSelectedId(null);
    setSelectedRecord(null);
    setSelectedCluster(null);
    setViewMode("tabletop");
  }, [data]);

  // Placement mode is a stateful AR-only concept; bail out of it the
  // moment the session ends so re-entering AR starts in "look" mode.
  useEffect(() => {
    if (!inXR && placementMode) setPlacementMode(false);
  }, [inXR, placementMode]);

  // If the user clears everything that could anchor Human Scale,
  // bounce back to Tabletop so the toolbar state stays coherent.
  useEffect(() => {
    if (viewMode === "human" && !selectedCluster && !selectedRecord) {
      setViewMode("tabletop");
    }
  }, [viewMode, selectedCluster, selectedRecord]);

  const handleSelect = useCallback((record, id) => {
    setSelectedId(id);
    setSelectedRecord(record);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedRecord(null);
  }, []);

  const handleClusterChange = useCallback((cluster) => {
    setSelectedCluster(cluster);
  }, []);

  const handleClearCluster = useCallback(() => {
    setSelectedCluster(null);
  }, []);

  // Shared projector used by the radius slider so changing radius
  // outside the Canvas can recompute the cluster correctly. Same
  // worldSize as the scene -- if the scene moves to a different size
  // this needs to follow.
  const projector = useMemo(() => {
    if (!data?.length) return null;
    const extent = getGeoExtent(data) ?? NYC_EXTENT;
    return createProjection(extent, { worldSize: VIEW_WORLD_SIZE });
  }, [data]);

  const handleClusterRadiusChange = useCallback(
    (nextRadius) => {
      if (!selectedCluster || !projector) return;
      const next = recomputeCluster(
        selectedCluster,
        data,
        projector,
        nextRadius
      );
      if (next) setSelectedCluster(next);
    },
    [selectedCluster, projector, data]
  );

  const handlePlaced = useCallback(() => {
    setPlacementMode(false);
  }, []);

  const handleEnterXR = useCallback(() => {
    try {
      if (xrCapability.mode === "immersive-vr") {
        xrStore.enterVR();
      } else {
        xrStore.enterAR();
      }
    } catch (err) {
      console.warn("enterXR failed", err);
    }
  }, [xrCapability.mode]);

  const handleExitAR = useCallback(() => {
    const session = xrStore.getState().session;
    if (session) session.end().catch(() => {});
  }, []);

  const canEnterScale = !!(selectedCluster || selectedRecord);
  const handleEnterScale = useCallback(() => {
    if (!canEnterScale) return;
    // If the user picked a single building (no cluster brushed), auto-
    // build a small cluster around that record so HumanScaleMode has
    // something to populate the human-scale block view with.
    if (!selectedCluster && selectedRecord && projector) {
      let centerIndex = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === selectedRecord) {
          centerIndex = i;
          break;
        }
      }
      const cluster = buildCluster({
        data,
        project: projector,
        centerRecord: selectedRecord,
        centerIndex,
        radius: 0.5,
      });
      if (cluster) setSelectedCluster(cluster);
    }
    setViewMode("human");
  }, [canEnterScale, selectedCluster, selectedRecord, projector, data]);
  const handleReturnTabletop = useCallback(() => {
    setViewMode("tabletop");
    setActiveTool("none");
  }, []);

  // AR has no shift-click — brush a cluster from the last selected
  // building instead (pinch / trigger select, then tap Brush area).
  const handleBrushClusterFromSelection = useCallback(() => {
    if (!selectedRecord || !projector) return;
    let centerIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === selectedRecord) {
        centerIndex = i;
        break;
      }
    }
    const cluster = buildCluster({
      data,
      project: projector,
      centerRecord: selectedRecord,
      centerIndex,
      radius: selectedCluster?.radius ?? DEFAULT_CLUSTER_RADIUS,
    });
    if (cluster) setSelectedCluster(cluster);
  }, [selectedRecord, selectedCluster, projector, data]);

  const arFlowHint = useMemo(() => {
    if (!inXR) return "";
    if (placementMode) {
      return "Aim at a table or floor, then pinch / trigger to place the model.";
    }
    if (viewMode === "human") {
      if (activeTool === "heightProbe") {
        return "Point at a building and pinch / trigger. Height Probe shows floors and rank.";
      }
      return "Look around the block. Pinch a building to inspect. Use Return for tabletop.";
    }
    if (selectedCluster) {
      return "Cluster selected. Tap Enter Scale to step inside at human height.";
    }
    if (selectedRecord) {
      return "Building selected. Tap Brush area to select nearby buildings, or Enter Scale.";
    }
    return "Pinch / trigger a building. Switch Height layer to spot tall clusters.";
  }, [
    inXR,
    placementMode,
    viewMode,
    activeTool,
    selectedCluster,
    selectedRecord,
  ]);

  const desktopPreview = !inXR;

  return (
    <div className="spatial-shell">
      <div className="spatial-toolbar">
        <div className="spatial-toolbar-identity">
          <div className="spatial-kicker">Immersive AR · WebXR</div>
          <h2>Levitating City Twin: XR Scale Explorer / {focusBorough}</h2>
          <p>
            {inXR ? (
              <>
                AR session active —{" "}
                {viewMode === "tabletop"
                  ? "tabletop twin on your surface."
                  : "human-scale inspection."}
              </>
            ) : canEnterXR ? (
              <>
                Tap <strong>Enter AR</strong> to place Manhattan on a real
                surface, then select an area and step inside at human scale.
              </>
            ) : (
              <>
                Desktop preview — {data.length.toLocaleString()} buildings.{" "}
                Open on Quest Browser (HTTPS) for the full AR experience.
              </>
            )}
          </p>
        </div>

        <div className="spatial-toolbar-controls">
          {canEnterXR && !inXR && (
            <button
              type="button"
              className="spatial-ar-btn spatial-ar-btn-primary"
              onClick={handleEnterXR}
            >
              {enterLabel}
            </button>
          )}

          {desktopPreview && (
            <>
              <div className="spatial-control-group">
                <span className="spatial-control-label">View</span>
                <div className="spatial-scale-tabs">
                  {VIEW_MODES.map((mode) => {
                    const disabled = mode.id === "human" && !canEnterScale;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        className={viewMode === mode.id ? "active" : ""}
                        disabled={disabled}
                        onClick={() => {
                          if (mode.id === "human") {
                            handleEnterScale();
                          } else {
                            handleReturnTabletop();
                          }
                        }}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="spatial-control-group">
                <span className="spatial-control-label">Layer</span>
                <div className="spatial-scale-tabs">
                  {LAYER_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={layerMode === mode.id ? "active" : ""}
                      onClick={() => setLayerMode(mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="spatial-canvas-wrap">
        {canEnterXR && !inXR && (
          <button
            type="button"
            className="spatial-ar-btn spatial-ar-btn-floating"
            onClick={handleEnterXR}
          >
            {enterLabel}
          </button>
        )}

        {!inXR && canEnterXR && (
          <div className="spatial-ar-hero">
            <strong>Designed for AR</strong>
            <ol>
              <li>Enter AR and place the borough on a table</li>
              <li>Switch to Height layer — tall clusters stand out</li>
              <li>Pinch a building, then brush the surrounding area</li>
              <li>Enter Scale — step inside at human height</li>
              <li>Use Height Probe and scenario ghosting in the block</li>
            </ol>
            <button type="button" onClick={handleEnterXR}>
              {enterLabel}
            </button>
          </div>
        )}

        {!inXR && xrCapability.status === "insecure" && (
          <div className="spatial-xr-hint">
            WebXR needs <strong>HTTPS</strong>. The Quest browser will not
            expose AR on <code>http://</code> network URLs. Use{" "}
            <code>npm run start:https</code> and open the{" "}
            <strong>https://</strong> link, or test the deployed site.
          </div>
        )}
        <LevitatingCityScene
          xrStore={xrStore}
          data={data}
          selectedId={selectedId}
          selectedRecord={selectedRecord}
          selectedCluster={selectedCluster}
          onSelect={handleSelect}
          onClearSelection={handleClearSelection}
          onClusterChange={handleClusterChange}
          onClearCluster={handleClearCluster}
          viewMode={viewMode}
          layerMode={layerMode}
          activeTool={activeTool}
          focusBorough={focusBorough}
          placementMode={placementMode}
          onPlaced={handlePlaced}
          onReturnTabletop={handleReturnTabletop}
          onStatsChange={setLayerStats}
        />

        {!inXR && (
          <LayerLegend layerMode={layerMode} stats={layerStats} />
        )}

        {!inXR && (
          <ToolPicker
            activeTool={activeTool}
            onChange={setActiveTool}
          />
        )}

        {!inXR && viewMode === "tabletop" && (
          <GuidedWalkthrough
            stops={MANHATTAN_STOPS}
            data={data}
            project={projector}
            onApplyLayer={setLayerMode}
            onApplyCluster={handleClusterChange}
            onEnterScale={handleEnterScale}
          />
        )}

        {!inXR && (
          <>
            <div className="spatial-instructions">
              <strong>
                {canEnterXR
                  ? "Desktop preview (AR recommended)"
                  : viewMode === "tabletop"
                  ? "Desktop controls"
                  : "Human-scale controls"}
              </strong>
              {canEnterXR ? (
                <>
                  <span>Use Enter AR for the intended experience</span>
                  <span>Desktop: drag orbit, click select, shift+click cluster</span>
                </>
              ) : viewMode === "tabletop" ? (
                <>
                  <span>Drag to orbit</span>
                  <span>Scroll to zoom</span>
                  <span>Click a building to inspect</span>
                  <span>Shift+click to brush a cluster</span>
                </>
              ) : (
                <>
                  <span>WASD / arrows to walk</span>
                  <span>Drag to look</span>
                  <span>Pick a tool, then click a building</span>
                </>
              )}
            </div>

            {selectedCluster ? (
              <ClusterSummaryPanel
                cluster={selectedCluster}
                radiusMin={CLUSTER_RADIUS_MIN}
                radiusMax={CLUSTER_RADIUS_MAX}
                onRadiusChange={handleClusterRadiusChange}
                onClear={handleClearCluster}
                onEnterScale={handleEnterScale}
                canEnterScale={canEnterScale && viewMode === "tabletop"}
              />
            ) : (
              <SelectionPanel
                record={selectedRecord}
                selectedId={selectedId}
                onClear={handleClearSelection}
              />
            )}
          </>
        )}

        {!inXR && viewMode === "tabletop" && canEnterScale && (
          <button
            type="button"
            className="spatial-enter-scale-btn"
            onClick={handleEnterScale}
          >
            Enter Scale
          </button>
        )}

        {!inXR && viewMode === "human" && (
          <button
            type="button"
            className="spatial-return-tabletop-btn"
            onClick={handleReturnTabletop}
          >
            Return to Tabletop
          </button>
        )}

        {inXR && (
          <div className="spatial-ar-banner spatial-ar-banner-expanded">
            <div className="spatial-ar-banner-row">
              <span className="spatial-ar-badge">AR</span>
              <span className="spatial-ar-hint">{arFlowHint}</span>
            </div>

            <div className="spatial-ar-banner-controls">
              <div className="spatial-ar-control-group">
                <span>Layer</span>
                <div className="spatial-ar-chip-row">
                  {LAYER_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={layerMode === mode.id ? "active" : ""}
                      onClick={() => setLayerMode(mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="spatial-ar-control-group">
                <span>Tool</span>
                <div className="spatial-ar-chip-row">
                  {TOOL_DEFS.filter((t) => t.available).map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={activeTool === tool.id ? "active" : ""}
                      onClick={() => setActiveTool(tool.id)}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="spatial-ar-banner-actions">
              <button
                type="button"
                className={placementMode ? "active" : ""}
                onClick={() => setPlacementMode((m) => !m)}
              >
                {placementMode ? "Cancel" : "Place"}
              </button>
              {selectedRecord && !selectedCluster && viewMode === "tabletop" && (
                <button type="button" onClick={handleBrushClusterFromSelection}>
                  Brush area
                </button>
              )}
              {canEnterScale && viewMode === "tabletop" && (
                <button
                  type="button"
                  className="spatial-ar-action-primary"
                  onClick={handleEnterScale}
                >
                  Enter Scale
                </button>
              )}
              {viewMode === "human" && (
                <button type="button" onClick={handleReturnTabletop}>
                  Return
                </button>
              )}
              <button type="button" onClick={handleExitAR}>
                Exit AR
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SpatialTwinView;
