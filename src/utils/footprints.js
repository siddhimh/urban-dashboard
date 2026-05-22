// NYC Building Footprints loader.
//
// Fetches real building polygon geometry from the NYC Open Data
// planimetric "BUILDING" dataset (`5zhs-2jue`) and matches each PLUTO
// record (which only has lat/lng) to the footprint it sits inside of,
// falling back to nearest-centroid if point-in-polygon fails.
//
//   PLUTO record (lat/lng)  ─┐
//                            ├─►  { geometry, heightRoof, groundElev, bin }
//   NYC Building Footprints ─┘
//
// Why this layer exists:
//
//   The existing city-scene-mapbox renderer draws every PLUTO record
//   as a generic 170 m × 170 m extruded box. That conveys "there is a
//   building here" but throws away the real city silhouette.
//
//   This module is step 1 of the "digital twin geometry" phase: we
//   load actual building polygons so the scene can extrude TRUE
//   footprints, not placeholder cubes. The box-based rendering is
//   still used as an instant-render baseline AND as a fallback for any
//   record we can't match (API error, record outside a densely-mapped
//   area, tile timeouts, etc.).
//
// Design:
//
//   - Batch spatial queries. For each chunk of ~20 records we issue
//     ONE `within_circle(the_geom, lat, lng, RADIUS_M) OR ...` query,
//     which returns every footprint near any record in the chunk in
//     a single request. Matching is then done client-side.
//   - Concurrency-limited (MAX_CONCURRENT). Socrata rate-limits us
//     without an app token and we want to stay polite.
//   - Two-level cache: in-memory (survives re-renders, lost on reload)
//     plus sessionStorage (survives tab reloads). A record we've
//     already looked up -- hit or miss -- is never re-queried.
//   - Errors never propagate. A failed batch marks its records as
//     "no footprint" and the renderer drops them back onto boxes.

// NYC Open Data "BUILDING" planimetric dataset. Each feature carries
// a MultiPolygon footprint + `height_roof` (feet) + `ground_elevation`
// (feet) + `bin` (Building Identification Number).
//
// This is the CORRECT id; earlier drafts pointed at `nqwf-w8eh` which
// doesn't exist on the portal and silently returned a 404 for every
// batch, forcing the whole scene onto the box fallback.
const FOOTPRINTS_API = 'https://data.cityofnewyork.us/resource/5zhs-2jue.geojson';

// Search radius (meters) around each PLUTO lat/lng. The record's
// reported coordinate usually falls inside its polygon, but some are
// off by 5-25 m depending on whether PLUTO stored the lot centroid or
// the primary building. 45 m gives headroom without pulling in a
// neighbor on dense blocks (typical NYC footprint is 8-20 m wide).
const SEARCH_RADIUS_M = 45;

// Records per chunked API call. Kept small enough that the OR'd query
// stays well under SoQL's query length limit and each response is
// bounded even in dense areas. 15 is the sweet spot between roundtrip
// count and per-response size.
const BATCH_SIZE = 15;

// Parallel in-flight requests. Higher => faster cold start but risks
// being throttled. 6 is a reasonable sweet spot for an anonymous client.
const MAX_CONCURRENT = 6;

// Columns pulled from Socrata. Smaller payload = faster transfer.
// Field names match the dataset's column_field_names exactly -- using
// the human labels (e.g. "heightroof") silently returns nothing.
const SELECT_FIELDS = 'the_geom,height_roof,ground_elevation,bin,base_bbl';

// Bump the prefix whenever the cache entry shape changes so old tabs
// don't feed stale data into new matchers.
const SESSION_CACHE_PREFIX = 'nyc-footprint:v2:';

// Sentinel for "we looked, nothing matched". Distinguishes a genuine
// cache miss (unknown record) from a known failure (already queried,
// no match) so we don't retry dead records on every filter change.
const MISS_SENTINEL = { __miss: true };

const memoryCache = new Map();

function recordKey(record) {
  // 6 decimals ≈ 11 cm precision. More than enough to dedupe PLUTO
  // records without collapsing distinct buildings.
  return `${(+record.latitude).toFixed(6)},${(+record.longitude).toFixed(6)}`;
}

function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_PREFIX + key);
    if (!raw) return undefined;
    if (raw === '0') return MISS_SENTINEL;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeSessionCache(key, value) {
  try {
    if (value === MISS_SENTINEL) {
      sessionStorage.setItem(SESSION_CACHE_PREFIX + key, '0');
    } else {
      sessionStorage.setItem(SESSION_CACHE_PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // Quota or private-mode: silently drop. Memory cache still works.
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBatch(records, { signal } = {}) {
  const clauses = records
    .map(
      (r) =>
        `within_circle(the_geom, ${+r.latitude}, ${+r.longitude}, ${SEARCH_RADIUS_M})`
    )
    .join(' OR ');
  const params = new URLSearchParams({
    $where: clauses,
    $select: SELECT_FIELDS,
    $limit: '5000',
  });
  const url = `${FOOTPRINTS_API}?${params.toString()}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Footprint API ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.features) ? json.features : [];
}

// Standard ray-casting point-in-polygon. Ring is [[lng, lat], ...].
// Degenerate rings (<3 points) return false.
function pointInPolygon(lng, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidOfRing(ring) {
  if (!ring || ring.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

// Normalize Polygon / MultiPolygon into an array of outer rings for
// fast point-in-polygon scanning. Holes are preserved on the feature
// for later extrusion but ignored for the initial match test.
function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly[0]).filter(Boolean);
  }
  return [];
}

// Find the footprint whose polygon CONTAINS the PLUTO lat/lng. If
// nothing contains it, pick the one with the closest centroid. Returns
// the matching feature or null.
function matchRecordToFeature(record, features) {
  const lat = +record.latitude;
  const lng = +record.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let containing = null;
  let nearest = null;
  let nearestDist = Infinity;

  for (const f of features) {
    const rings = outerRings(f.geometry);
    if (rings.length === 0) continue;

    for (const ring of rings) {
      if (pointInPolygon(lng, lat, ring)) {
        containing = f;
        break;
      }
    }
    if (containing === f) break;

    // Use the outer ring's centroid as a cheap proximity proxy. No
    // need for a true polygon centroid at this stage -- we only use
    // it to fall back when containment fails.
    const c = centroidOfRing(rings[0]);
    if (c) {
      const dlng = c[0] - lng;
      const dlat = c[1] - lat;
      const d2 = dlng * dlng + dlat * dlat;
      if (d2 < nearestDist) {
        nearestDist = d2;
        nearest = f;
      }
    }
  }

  return containing ?? nearest;
}

function toCacheEntry(feature) {
  if (!feature) return MISS_SENTINEL;
  const props = feature.properties ?? {};
  return {
    geometry: feature.geometry,
    // Column names on 5zhs-2jue are snake_cased: height_roof /
    // ground_elevation. Values come back as strings -- coerce with +
    // and guard against missing roof heights (null-extruded buildings
    // get the numfloors fallback in the mesh builder).
    heightRoof: Number.isFinite(+props.height_roof) ? +props.height_roof : null,
    groundElev: Number.isFinite(+props.ground_elevation)
      ? +props.ground_elevation
      : null,
    bin: props.bin ?? null,
    baseBBL: props.base_bbl ?? null,
  };
}

// Resolve footprints for every record in `records`. Returns
//   Map<recordIndex, { geometry, heightRoof, groundElev, bin }>
// for matched records only. Unmatched records are simply absent from
// the map -- the caller should keep them on the box renderer.
//
// Options:
//   signal     : AbortSignal (aborts in-flight requests, safe to ignore)
//   onProgress : ({ matched, attempted, total }) => void
export async function fetchFootprintsForRecords(records, options = {}) {
  const signal = options.signal;
  const onProgress = options.onProgress;
  const results = new Map();

  if (!Array.isArray(records) || records.length === 0) {
    return results;
  }

  const toFetch = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) continue;
    const key = recordKey(r);

    let cached = memoryCache.get(key);
    if (cached === undefined) {
      cached = readSessionCache(key);
      if (cached !== undefined) memoryCache.set(key, cached);
    }

    if (cached !== undefined) {
      if (cached !== MISS_SENTINEL) results.set(i, cached);
    } else {
      toFetch.push({ index: i, record: r, key });
    }
  }

  let attempted = records.length - toFetch.length;
  if (onProgress) {
    onProgress({
      matched: results.size,
      attempted,
      total: records.length,
    });
  }

  if (toFetch.length === 0) return results;

  const batches = chunkArray(toFetch, BATCH_SIZE);

  await new Promise((resolve) => {
    let active = 0;
    let next = 0;
    let done = 0;

    const launch = () => {
      if (signal?.aborted) {
        if (done === batches.length) resolve();
        return;
      }
      while (active < MAX_CONCURRENT && next < batches.length) {
        const myBatch = batches[next++];
        active++;
        fetchBatch(
          myBatch.map((x) => x.record),
          { signal }
        )
          .then((features) => {
            for (const item of myBatch) {
              const feature = matchRecordToFeature(item.record, features);
              const entry = toCacheEntry(feature);
              memoryCache.set(item.key, entry);
              writeSessionCache(item.key, entry);
              if (entry !== MISS_SENTINEL) results.set(item.index, entry);
            }
          })
          .catch(() => {
            // Per-batch failure is non-fatal. Do NOT cache the miss
            // here -- leaving the record uncached means a future call
            // (e.g. after a filter change) will retry the fetch
            // instead of permanently downgrading it to a box.
          })
          .finally(() => {
            active--;
            done++;
            attempted += myBatch.length;
            if (onProgress) {
              onProgress({
                matched: results.size,
                attempted,
                total: records.length,
              });
            }
            if (done === batches.length) resolve();
            else launch();
          });
      }
    };

    launch();
  });

  return results;
}

// Cheap read-only accessor for callers that want to check whether a
// specific record is already resolved without triggering a fetch.
export function getCachedFootprint(record) {
  const key = recordKey(record);
  let entry = memoryCache.get(key);
  if (entry === undefined) {
    entry = readSessionCache(key);
    if (entry !== undefined) memoryCache.set(key, entry);
  }
  if (entry === undefined || entry === MISS_SENTINEL) return null;
  return entry;
}
