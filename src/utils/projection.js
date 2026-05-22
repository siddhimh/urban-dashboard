// Geographic → 3D scene projection helpers.
//
// Pure functions. No three / no R3F imports. Consumed by the 3D layer
// (and re-usable from 2D if ever needed).
//
// Conventions:
//   - Three.js is Y-up. The ground plane lies on the X/Z plane.
//   - We map longitude → x and latitude → z.
//   - North (higher latitude) points toward -z so that, with a default
//     camera looking from +x/+y/+z, "up the screen" feels like "north".
//   - Output is centered on (0, 0) so the scene origin sits at the
//     geographic centroid of the dataset.
//   - Aspect ratio is preserved (no axis stretching).
//   - Latitude/longitude distortion is corrected by scaling longitude by
//     cos(centerLat) -- a standard equirectangular approximation that's
//     plenty accurate for a single city.

const DEFAULT_LNG_KEY = 'longitude';
const DEFAULT_LAT_KEY = 'latitude';
const DEFAULT_WORLD_SIZE = 300;

// Shared, STABLE NYC extent. Using a fixed extent (instead of one derived
// from the current dataset) keeps building world coordinates invariant
// under filtering -- so "fly to the filtered bbox" can actually zoom in
// on a geographic cluster instead of always seeing a rescaled full world.
export const NYC_EXTENT = {
  minLng: -74.3,
  maxLng: -73.65,
  minLat: 40.4,
  maxLat: 40.95,
  centerLng: (-74.3 + -73.65) / 2,
  centerLat: (40.4 + 40.95) / 2,
};

// Convenience: stable NYC projector shared by all 3D layers.
export function createNYCProjector(options = {}) {
  return createProjection(NYC_EXTENT, options);
}

// Pull a numeric value from a record. Tolerates string CSV fields.
function readNumber(record, key) {
  const raw = record?.[key];
  if (raw === undefined || raw === null || raw === '') return NaN;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// Compute lng/lat extent + center for a dataset.
// Returns null when there are no valid coordinates.
export function getGeoExtent(data, options = {}) {
  const lngKey = options.lngKey ?? DEFAULT_LNG_KEY;
  const latKey = options.latKey ?? DEFAULT_LAT_KEY;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let count = 0;

  for (const d of data) {
    const lng = readNumber(d, lngKey);
    const lat = readNumber(d, latKey);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    count++;
  }

  if (count === 0) return null;

  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    centerLng: (minLng + maxLng) / 2,
    centerLat: (minLat + maxLat) / 2,
    count,
  };
}

// Build a projection function: (lng, lat) -> { x, z }.
// Aspect-preserving fit inside a worldSize × worldSize box centered at origin.
//
// Usage:
//   const project = createProjection(extent, { worldSize: 300 });
//   const { x, z } = project(lng, lat);
export function createProjection(extent, options = {}) {
  const worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;

  if (!extent) {
    // Degenerate case: no data. Return identity-ish projection at origin
    // so callers don't have to special-case it.
    return () => ({ x: 0, z: 0 });
  }

  const { minLng, maxLng, minLat, maxLat, centerLng, centerLat } = extent;

  // Equirectangular correction: 1 deg of longitude is shorter than 1 deg
  // of latitude away from the equator. Scale lng by cos(centerLat).
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  // Spans in "corrected degrees" so width/height are comparable.
  const lngSpan = Math.max((maxLng - minLng) * cosLat, 1e-9);
  const latSpan = Math.max(maxLat - minLat, 1e-9);

  // Fit the larger span to worldSize, preserving aspect ratio.
  const scale = worldSize / Math.max(lngSpan, latSpan);

  return function project(lng, lat) {
    const x = (lng - centerLng) * cosLat * scale;
    // Negate so higher latitudes (north) sit at -z.
    const z = -(lat - centerLat) * scale;
    return { x, z };
  };
}

// Convenience: build a projector from raw data in one call.
//   const project = projectorFromData(filteredData, { worldSize: 300 });
export function projectorFromData(data, options = {}) {
  const extent = getGeoExtent(data, options);
  return createProjection(extent, options);
}
