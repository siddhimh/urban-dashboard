// Shared building colors for the spatial twin (box + footprint layers).
//
// Two coloring modes:
//   - Neutral: borough palette + per-id HSL nudge (default, original look).
//   - Metric:  d3 sequential interpolator over a numeric attribute, with
//              top-5% emphasis (saturation + brightness boost).
// Hover / select colors are fixed for readability in both modes and
// regardless of which renderer is currently active.

import * as THREE from "three";
import * as d3 from "d3";
import { getBuildingColor } from "./building-color";
import { DIVERGING_INTERPOLATOR } from "../colors";

export const SPATIAL_HOVER = new THREE.Color("#ff4f8b");
export const SPATIAL_SELECT = new THREE.Color("#39d5ff");
export const SPATIAL_CLUSTER = new THREE.Color("#9af7c0");

// Metric layer color stops -- chosen for visibility in both dark
// desktop and AR passthrough. We don't reuse the diverging palette
// here so "Height" reads as a single warm-to-cool ramp rather than
// the dashboard's symmetric diverging look.
const HEIGHT_RAMP = d3.interpolateRgbBasis([
  "#1c3a4e",
  "#2c6f8b",
  "#9ed7ff",
  "#ffd86b",
  "#ff7a3d",
]);

const DENSITY_RAMP = d3.interpolateRgbBasis([
  "#1f1e3a",
  "#3b357d",
  "#7a4bd5",
  "#d76bd3",
  "#ffb3e6",
]);

const AGE_RAMP = DIVERGING_INTERPOLATOR;

function rampFor(layerMode) {
  if (layerMode === "height") return HEIGHT_RAMP;
  if (layerMode === "density") return DENSITY_RAMP;
  if (layerMode === "age") return AGE_RAMP;
  return null;
}

function readMetric(record, layerMode) {
  if (layerMode === "height") {
    const n = Number(record?.numfloors);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }
  if (layerMode === "density") {
    const n = Number(record?.bldgarea);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }
  if (layerMode === "age") {
    const n = Number(record?.yearbuilt);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }
  return NaN;
}

// Build a normalizer (record -> 0..1) for a layer mode against a stat
// summary. Clamps so a single outlier doesn't compress the whole
// ramp into a single end-stop.
export function buildMetricNormalizer(layerMode, stats) {
  const ramp = rampFor(layerMode);
  if (!ramp || !stats) return null;
  const key =
    layerMode === "height"
      ? "floors"
      : layerMode === "density"
      ? "area"
      : layerMode === "age"
      ? "year"
      : null;
  const s = key ? stats[key] : null;
  if (!s || s.sorted.length === 0) return null;
  // Use p5..p95 as the visible range so the ramp isn't dominated by
  // extreme outliers (one super-tall tower per dataset).
  const lo = s.p5;
  const hi = s.p95;
  const range = Math.max(hi - lo, 1e-6);
  return {
    layerMode,
    ramp,
    lo,
    hi,
    top5Threshold: s.top5Threshold,
    normalize(value) {
      if (!Number.isFinite(value)) return null;
      return THREE.MathUtils.clamp((value - lo) / range, 0, 1);
    },
  };
}

const FALLBACK_NEUTRAL = new THREE.Color("#5a6b7a");

/**
 * Resolve the instance / mesh color for one building record.
 *
 * @param {object} record - PLUTO row
 * @param {string|number} id - building id
 * @param {string|number|null} hoveredId
 * @param {string|number|null} selectedId
 * @param {(id: string|number) => number} [hashId] - optional [0,1) hash for roof variation
 * @param {THREE.Color} [target] - reuse buffer to avoid allocations in hot loops
 * @param {object} [opts]
 * @param {"neutral"|"height"|"density"|"age"} [opts.layerMode]
 * @param {object} [opts.normalizer] - from buildMetricNormalizer
 * @param {boolean} [opts.inCluster] - true if record belongs to the active cluster
 */
export function resolveBuildingColor(
  record,
  id,
  hoveredId,
  selectedId,
  hashId,
  target = new THREE.Color(),
  opts = {}
) {
  if (id != null && id === selectedId) {
    return target.copy(SPATIAL_SELECT);
  }
  if (id != null && id === hoveredId) {
    return target.copy(SPATIAL_HOVER);
  }

  const layerMode = opts.layerMode ?? "neutral";
  const normalizer = opts.normalizer ?? null;

  if (layerMode !== "neutral" && normalizer) {
    const v = readMetric(record, layerMode);
    const t = normalizer.normalize(v);
    if (t != null) {
      target.set(normalizer.ramp(t));
      // Top 5% gets a small saturation + brightness boost so dense
      // / tall clusters jump out of the model.
      if (v >= normalizer.top5Threshold) {
        target.offsetHSL(0, 0.08, 0.08);
      } else if (hashId) {
        target.offsetHSL(0, 0, (hashId(id) - 0.5) * 0.06);
      }
    } else {
      target.copy(FALLBACK_NEUTRAL);
    }
  } else {
    target.set(getBuildingColor(record));
    if (hashId) {
      target.offsetHSL(0, 0, (hashId(id) - 0.5) * 0.18);
    }
  }

  if (opts.inCluster) {
    // Tint the building toward cluster green without losing the
    // underlying layer color entirely.
    target.lerp(SPATIAL_CLUSTER, 0.45);
  }

  return target;
}

// Convenience: lookup label + ramp for the legend.
export function getLayerMeta(layerMode, stats) {
  if (layerMode === "height") {
    return {
      label: "Height",
      unit: "floors",
      ramp: HEIGHT_RAMP,
      lo: stats?.floors?.p5 ?? 0,
      hi: stats?.floors?.p95 ?? 0,
    };
  }
  if (layerMode === "density") {
    return {
      label: "Density (footprint area)",
      unit: "sqft",
      ramp: DENSITY_RAMP,
      lo: stats?.area?.p5 ?? 0,
      hi: stats?.area?.p95 ?? 0,
    };
  }
  if (layerMode === "age") {
    return {
      label: "Age",
      unit: "year built",
      ramp: AGE_RAMP,
      lo: stats?.year?.p5 ?? 0,
      hi: stats?.year?.p95 ?? 0,
    };
  }
  return { label: "Neutral", unit: "", ramp: null, lo: 0, hi: 0 };
}
