// DOM panel that summarizes the active cluster.
//
// Reuses the same dark-glass style as SelectionPanel. Includes a
// radius slider so the user can grow / shrink the brush without
// re-picking a center building.

const fmt = (n, fallback = "—") =>
  Number.isFinite(+n) ? Math.round(+n).toLocaleString() : fallback;

const fmtDecimal = (n, fallback = "—") =>
  Number.isFinite(+n) ? (Math.round(+n * 10) / 10).toLocaleString() : fallback;

function ClusterSummaryPanel({
  cluster,
  radiusMin,
  radiusMax,
  onRadiusChange,
  onClear,
  onEnterScale,
  canEnterScale,
}) {
  if (!cluster) return null;
  const s = cluster.summary;

  return (
    <div className="spatial-cluster-card">
      <button
        type="button"
        className="close-btn"
        onClick={onClear}
        aria-label="Clear cluster"
      >
        ×
      </button>

      <div className="card-label">Cluster summary</div>

      <div className="spatial-selection-title">
        <span
          className="spatial-selection-dot"
          style={{ background: "#9af7c0" }}
        />
        <h3>{s.count.toLocaleString()} buildings in radius</h3>
      </div>

      <div className="metric-grid">
        <div>
          <span>Avg floors</span>
          <strong>{fmtDecimal(s.avgFloors)}</strong>
        </div>
        <div>
          <span>Tallest</span>
          <strong>{fmt(s.tallestFloors)} fl</strong>
        </div>
        <div>
          <span>Median year</span>
          <strong>{fmt(s.medianYear)}</strong>
        </div>
        <div>
          <span>Density score</span>
          <strong>{fmt(s.densityScore)}</strong>
        </div>
        <div className="metric-wide">
          <span>Dominant land use</span>
          <strong>{s.dominantLanduseLabel ?? "—"}</strong>
        </div>
      </div>

      <div className="spatial-cluster-radius">
        <div className="spatial-cluster-radius-label">
          <span>Radius</span>
          <span>{(cluster.radius).toFixed(2)} u</span>
        </div>
        <input
          type="range"
          min={radiusMin}
          max={radiusMax}
          step={0.05}
          value={cluster.radius}
          onChange={(e) => onRadiusChange?.(+e.target.value)}
        />
      </div>

      {canEnterScale && (
        <button
          type="button"
          className="spatial-cluster-enter-btn"
          onClick={onEnterScale}
        >
          Enter Scale →
        </button>
      )}
    </div>
  );
}

export default ClusterSummaryPanel;
