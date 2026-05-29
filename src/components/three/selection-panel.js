// Selected-building card for the Levitating City Twin.
//
// Replaces the inline card that used to live in SpatialTwinView. Pure
// presentational: receives a record, fires onClear, never reaches up
// into App state. Styled by `.spatial-selection-card` + helpers in
// `src/components/layout/spatial-twin.css` so the look matches the
// rest of the dark-glass UI.

import { BOROUGH_NAMES, BOROUGH_PALETTE } from "../../colors";
import {
  clearProposal,
  setProposedFloors,
  useProposedFloors,
} from "./scenario-store";

const LAND_USE_LABELS = {
  "1": "One & Two Family",
  "2": "Multi-Family Walk-Up",
  "3": "Multi-Family Elevator",
  "4": "Mixed Res / Commercial",
  "5": "Commercial & Office",
  "6": "Industrial & Manufacturing",
  "7": "Transport & Utility",
  "8": "Public Facilities",
  "9": "Open Space",
  "10": "Parking",
  "11": "Vacant Land",
};

const fmt = (n) =>
  Number.isFinite(+n) ? Math.round(+n).toLocaleString() : "—";

function SelectionPanel({ record, onClear, selectedId }) {
  // Note: hooks must be called unconditionally. If no record, we use
  // a stable placeholder id so the hook still fires but its result is
  // ignored downstream.
  const proposalId = selectedId ?? record?.bbl ?? record?.bin ?? record?.id ?? null;
  const proposedFloors = useProposedFloors(proposalId);

  if (!record) return null;

  const boroughCode = record.borough;
  const boroughLabel = BOROUGH_NAMES[boroughCode] ?? boroughCode ?? "—";
  const boroughColor = BOROUGH_PALETTE[boroughCode] ?? "#39d5ff";

  const baseFloors = Math.max(1, Math.round(+record.numfloors || 1));
  const currentProposal = proposedFloors ?? baseFloors;
  const delta = currentProposal - baseFloors;

  const adjust = (next) => {
    const clamped = Math.max(1, Math.min(120, Math.round(next)));
    if (clamped === baseFloors) {
      clearProposal(proposalId);
    } else if (proposalId != null) {
      setProposedFloors(proposalId, clamped);
    }
  };

  const landuseCode =
    record.landuse != null && record.landuse !== ""
      ? String(Math.round(+record.landuse))
      : null;
  const landuseLabel = landuseCode
    ? LAND_USE_LABELS[landuseCode] ?? `Land Use ${landuseCode}`
    : "—";

  const year =
    Number.isFinite(+record.yearbuilt) && +record.yearbuilt > 0
      ? record.yearbuilt
      : "—";
  const zoning = record.zonedist1 || "—";

  return (
    <div className="spatial-selection-card">
      <button
        type="button"
        className="close-btn"
        onClick={onClear}
        aria-label="Clear selection"
      >
        ×
      </button>

      <div className="card-label">Selected building</div>

      <div className="spatial-selection-title">
        <span
          className="spatial-selection-dot"
          style={{ background: boroughColor }}
        />
        <h3 title={record.address || "NYC Building"}>
          {record.address || "NYC Building"}
        </h3>
      </div>

      <div className="metric-grid">
        <div>
          <span>Borough</span>
          <strong>{boroughLabel}</strong>
        </div>
        <div>
          <span>Floors</span>
          <strong>{fmt(record.numfloors)}</strong>
        </div>
        <div>
          <span>Year</span>
          <strong>{year}</strong>
        </div>
        <div>
          <span>Area</span>
          <strong>{fmt(record.bldgarea)} sqft</strong>
        </div>
        <div>
          <span>Land Use</span>
          <strong>{landuseLabel}</strong>
        </div>
        <div>
          <span>Zoning</span>
          <strong>{zoning}</strong>
        </div>
      </div>

      <div className="spatial-scenario-section">
        <div className="spatial-scenario-label">
          <span>Scenario massing</span>
          {delta !== 0 && (
            <span className="spatial-scenario-delta">
              {delta > 0 ? "+" : ""}
              {delta} floors
            </span>
          )}
        </div>
        <div className="spatial-scenario-row">
          <button
            type="button"
            className="spatial-scenario-btn"
            onClick={() => adjust(currentProposal - 1)}
            aria-label="Decrease proposed floors"
          >
            −
          </button>
          <div className="spatial-scenario-value">
            <strong>{currentProposal}</strong>
            <span>proposed floors</span>
          </div>
          <button
            type="button"
            className="spatial-scenario-btn"
            onClick={() => adjust(currentProposal + 1)}
            aria-label="Increase proposed floors"
          >
            +
          </button>
        </div>
        {delta !== 0 && (
          <button
            type="button"
            className="spatial-scenario-reset"
            onClick={() => clearProposal(proposalId)}
          >
            Reset to original ({baseFloors})
          </button>
        )}
      </div>
    </div>
  );
}

export default SelectionPanel;
