//filter bar describing the various filters being applied
import { BOROUGH_NAMES, BOROUGH_PALETTE, BOROUGH_ORDER } from "../../colors";

function FiltersBar({
  selectedBoroughs,
  toggleBorough,
  activeFilters,
  clearFilter,
  clearAll,
}) {
  return (
    <div className="filters-bar">
      <div className="filter-group">
        <label>Borough</label>

        <div className="borough-chips">
          {BOROUGH_ORDER.map((b) => (
            <button
              key={b}
              className={`borough-chip ${selectedBoroughs.has(b) ? "active" : ""}`}
              style={{
                "--chip-color": BOROUGH_PALETTE[b],
                borderColor: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] : undefined,
                background: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] + "18" : undefined,
                color: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] : undefined,
              }}
              onClick={() => toggleBorough(b)}
            >
              <span
                className="chip-dot"
                style={{ background: BOROUGH_PALETTE[b] }}
              ></span>
              {BOROUGH_NAMES[b]}
            </button>
          ))}
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="active-filters">
          {activeFilters.map((filter) => (
            <span
              key={filter.key}
              className="filter-tag"
              onClick={() => clearFilter(filter.key)}
            >
              {filter.label} <span className="clear-x">&times;</span>
            </span>
          ))}

          {activeFilters.length > 1 && (
            <button className="clear-all-btn" onClick={clearAll}>
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FiltersBar;