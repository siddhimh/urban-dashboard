// Per-dataset statistics used to drive layer-mode coloring and the
// Height Probe's "taller than X% of nearby buildings" copy.
//
// Pure functions. No three / no R3F imports. The output is intended
// to live in a React useMemo so it's only recomputed when `data`
// changes.
//
// Key shape:
//   {
//     count,
//     floors:  { min, max, p5, p50, p95, top5Threshold, sorted },
//     area:    { min, max, p5, p50, p95, top5Threshold, sorted },
//     year:    { min, max, p50 },
//   }
//
// `sorted` is the ascending value array used by `percentileRank` so
// the Height Probe can answer "this building is taller than N% of the
// borough" in O(log n).

import * as d3 from "d3";

function readNumber(record, key) {
  const v = record?.[key];
  if (v == null || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function collectFinite(data, accessor) {
  const out = [];
  for (const d of data) {
    const v = accessor(d);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

// Single pass that gives us min / max / median / a couple percentile
// stops plus the ascending values for later rank lookups.
function summarize(values) {
  if (!values.length) {
    return {
      min: 0,
      max: 0,
      p5: 0,
      p50: 0,
      p95: 0,
      top5Threshold: 0,
      sorted: [],
    };
  }
  values.sort(d3.ascending);
  const last = values.length - 1;
  return {
    min: values[0],
    max: values[last],
    p5: d3.quantile(values, 0.05) ?? values[0],
    p50: d3.quantile(values, 0.5) ?? values[Math.floor(last / 2)],
    p95: d3.quantile(values, 0.95) ?? values[last],
    top5Threshold: d3.quantile(values, 0.95) ?? values[last],
    sorted: values,
  };
}

// O(log n) percentile rank against a pre-sorted array. Returns 0..1.
export function percentileRank(sorted, value) {
  if (!Array.isArray(sorted) || sorted.length === 0) return 0;
  if (!Number.isFinite(value)) return 0;

  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

export function buildLayerStats(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      count: 0,
      floors: summarize([]),
      area: summarize([]),
      year: summarize([]),
    };
  }

  const floors = collectFinite(data, (d) => readNumber(d, "numfloors"));
  const area = collectFinite(data, (d) => readNumber(d, "bldgarea"));
  const year = collectFinite(data, (d) => readNumber(d, "yearbuilt"));

  return {
    count: data.length,
    floors: summarize(floors),
    area: summarize(area),
    year: summarize(year),
  };
}
