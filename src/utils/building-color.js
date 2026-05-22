// Color helpers for the 3D scene.
//
// Single source of truth for the palette is `src/colors.js` (already
// used by the 2D dashboard). This module just adapts that palette into
// reusable functions for the 3D layer so both views stay in lockstep:
//
//   - Categorical:  borough  -> hex   (matches BoroughBar / DotMap legends)
//   - Continuous:   metric   -> hex   (matches DotMap floor coloring)
//
// Pure functions. No three / no R3F imports -- hex strings work directly
// with THREE.Color, MeshStandardMaterial, etc.

import * as d3 from 'd3';
import {
  BOROUGH_PALETTE,
  BOROUGH_ORDER,
  BOROUGH_NAMES,
  DIVERGING_INTERPOLATOR,
} from '../colors';

// Neutral fallback for unknown / missing values.
const FALLBACK_COLOR = '#9a9cb0';

// ---------------------------------------------------------------------------
// Categorical: borough -> color
// ---------------------------------------------------------------------------

// Map a borough code (e.g. "MN") to its hex color.
export function getBoroughColor(borough) {
  if (!borough) return FALLBACK_COLOR;
  return BOROUGH_PALETTE[borough] ?? FALLBACK_COLOR;
}

// Map a building/lot record to its borough color.
export function getBuildingColor(record, options = {}) {
  const key = options.boroughKey ?? 'borough';
  return getBoroughColor(record?.[key]);
}

// ---------------------------------------------------------------------------
// Continuous: metric -> color
// ---------------------------------------------------------------------------
//
// Two-step API:
//   1. Build a scale fn from a domain (or directly from data).
//   2. Call the returned fn with a numeric value to get a hex color.
//
// Default interpolator is DIVERGING_INTERPOLATOR (cool -> neutral -> warm),
// the same ramp used by the 2D DotMap, so 3D / 2D colorings stay aligned.

// Build a metric color scale from an explicit [min, max] domain.
//
//   const colorByFloors = createMetricColorScale([1, 40]);
//   colorByFloors(12); // -> "#..."
//
// options:
//   interpolator : d3 interpolator    (default DIVERGING_INTERPOLATOR)
//   clamp        : boolean            (default true)
export function createMetricColorScale(domain, options = {}) {
  const interpolator = options.interpolator ?? DIVERGING_INTERPOLATOR;
  const clamp = options.clamp !== false;

  const [rawMin, rawMax] = domain ?? [];
  const safeMin = Number.isFinite(rawMin) ? rawMin : 0;
  const safeMax =
    Number.isFinite(rawMax) && rawMax > safeMin ? rawMax : safeMin + 1;

  const scale = d3
    .scaleSequential()
    .domain([safeMin, safeMax])
    .interpolator(interpolator);
  if (clamp) scale.clamp(true);

  return function metricColor(value) {
    const v = Number(value);
    return scale(Number.isFinite(v) ? v : safeMin);
  };
}

// Build a metric color scale straight from a dataset.
//
//   const colorByFloors = createMetricColorScaleFromData(
//     filteredData,
//     'numfloors',
//   );
//   colorByFloors(record.numfloors);
//
// `accessor` may be a string field name or a function (record -> number).
//
// Uses a percentile cap to avoid a single outlier skewing the scale --
// mirrors the strategy DotMap already uses for its floor coloring.
//
// options:
//   interpolator     : passed through to createMetricColorScale
//   clamp            : passed through to createMetricColorScale
//   upperPercentile  : 0..1   (default 0.95)
//   lowerPercentile  : 0..1   (default 0    -> use raw min)
//   fallbackDomain   : [a, b] (default [0, 1], used when no valid values)
export function createMetricColorScaleFromData(data, accessor, options = {}) {
  const upperPercentile = options.upperPercentile ?? 0.95;
  const lowerPercentile = options.lowerPercentile ?? 0;
  const fallbackDomain = options.fallbackDomain ?? [0, 1];

  const read =
    typeof accessor === 'function'
      ? accessor
      : (d) => Number(d?.[accessor]);

  const values = [];
  if (data) {
    for (const d of data) {
      const v = read(d);
      if (Number.isFinite(v)) values.push(v);
    }
  }

  if (values.length === 0) {
    return createMetricColorScale(fallbackDomain, options);
  }

  values.sort(d3.ascending);
  const min =
    lowerPercentile <= 0
      ? values[0]
      : d3.quantile(values, lowerPercentile) ?? values[0];
  const max =
    d3.quantile(values, upperPercentile) ?? values[values.length - 1];

  return createMetricColorScale([min, max], options);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  BOROUGH_PALETTE,
  BOROUGH_ORDER,
  BOROUGH_NAMES,
  DIVERGING_INTERPOLATOR,
  FALLBACK_COLOR,
};
