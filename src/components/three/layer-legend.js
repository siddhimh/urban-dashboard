// Small floating legend that explains the active layer mode.
//
// Pure DOM overlay (not part of the Canvas), so it lives outside the
// XR session entirely. In AR the immersive compositor hides DOM
// overlays automatically, which is what we want -- the in-headset
// legend would belong to a future <Html transform> sprite.

import { useMemo } from "react";
import { getLayerMeta } from "../../utils/spatial-colors";

const SAMPLES = 8;

function fmtRange(v, unit) {
  if (!Number.isFinite(v)) return "—";
  if (unit === "year built") return Math.round(v).toString();
  if (unit === "floors") return Math.round(v).toString();
  if (unit === "sqft") {
    if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
    return Math.round(v).toString();
  }
  return Math.round(v).toString();
}

function LayerLegend({ layerMode = "neutral", stats }) {
  const meta = useMemo(
    () => getLayerMeta(layerMode, stats),
    [layerMode, stats]
  );

  if (layerMode === "neutral" || !meta.ramp) return null;

  const stops = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    stops.push(meta.ramp(t));
  }

  return (
    <div className="spatial-layer-legend">
      <div className="spatial-layer-legend-label">
        <span>{meta.label}</span>
        <span className="spatial-layer-legend-unit">{meta.unit}</span>
      </div>
      <div
        className="spatial-layer-legend-ramp"
        style={{
          backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
        }}
      />
      <div className="spatial-layer-legend-range">
        <span>{fmtRange(meta.lo, meta.unit)}</span>
        <span>{fmtRange(meta.hi, meta.unit)}</span>
      </div>
      <div className="spatial-layer-legend-note">
        Top 5% emphasized in saturation.
      </div>
    </div>
  );
}

export default LayerLegend;
