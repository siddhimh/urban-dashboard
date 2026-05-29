// Guided walkthrough overlay.
//
// A small bottom strip showing the active stop + prev / next buttons.
// Selecting (or advancing into) a stop:
//   1. Switches the layer mode to the stop's recommended layer.
//   2. Builds a cluster from the dataset around the stop's centerLngLat
//      + radius, and pushes it into the parent's cluster state.
//   3. Optionally enables Enter Scale.
//
// The walkthrough is fully pause-able: closing the overlay leaves
// whatever state was last applied.

import { useCallback, useState } from "react";
import { buildCluster } from "./cluster-controller";

function findCenterRecord(data, project, lngLat, radius) {
  if (!data?.length || !project) return null;
  const center = project(lngLat[0], lngLat[1]);
  const r2 = radius * radius;
  let best = null;
  let bestIndex = -1;
  let bestDist = Infinity;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d) continue;
    const lng = +d.longitude;
    const lat = +d.latitude;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const { x, z } = project(lng, lat);
    const dx = x - center.x;
    const dz = z - center.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    if (d2 < bestDist) {
      bestDist = d2;
      best = d;
      bestIndex = i;
    }
  }
  return { record: best, index: bestIndex };
}

function GuidedWalkthrough({
  stops,
  data,
  project,
  onApplyLayer,
  onApplyCluster,
  onEnterScale,
  initialOpen = false,
}) {
  const [open, setOpen] = useState(initialOpen);
  const [index, setIndex] = useState(0);
  const stop = stops?.[index];

  const applyStop = useCallback(
    (next) => {
      if (!next || !data?.length || !project) return;
      onApplyLayer?.(next.layer ?? "neutral");
      const center = findCenterRecord(
        data,
        project,
        next.centerLngLat,
        next.radius
      );
      if (center?.record) {
        const cluster = buildCluster({
          data,
          project,
          centerRecord: center.record,
          centerIndex: center.index,
          radius: next.radius,
        });
        if (cluster) onApplyCluster?.(cluster);
      }
    },
    [data, project, onApplyLayer, onApplyCluster]
  );

  const go = useCallback(
    (delta) => {
      if (!stops?.length) return;
      const nextIndex = (index + delta + stops.length) % stops.length;
      setIndex(nextIndex);
      applyStop(stops[nextIndex]);
    },
    [index, stops, applyStop]
  );

  const start = useCallback(() => {
    setOpen(true);
    applyStop(stops?.[index]);
  }, [applyStop, stops, index]);

  if (!open) {
    return (
      <button
        type="button"
        className="spatial-walkthrough-toggle"
        onClick={start}
      >
        Start Guided Walkthrough
      </button>
    );
  }

  if (!stop) return null;

  const total = stops.length;

  return (
    <div className="spatial-walkthrough">
      <div className="spatial-walkthrough-header">
        <span className="spatial-walkthrough-step">
          Stop {index + 1} of {total}
        </span>
        <button
          type="button"
          className="spatial-walkthrough-close"
          onClick={() => setOpen(false)}
          aria-label="Close walkthrough"
        >
          ×
        </button>
      </div>
      <div className="spatial-walkthrough-title">{stop.title}</div>
      <div className="spatial-walkthrough-blurb">{stop.blurb}</div>
      <div className="spatial-walkthrough-controls">
        <button type="button" onClick={() => go(-1)}>
          ← Prev
        </button>
        {stop.allowEnterScale && (
          <button
            type="button"
            className="spatial-walkthrough-enter"
            onClick={onEnterScale}
          >
            Enter Scale
          </button>
        )}
        <button type="button" onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  );
}

export default GuidedWalkthrough;
