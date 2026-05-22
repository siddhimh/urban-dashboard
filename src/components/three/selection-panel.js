// Selection details panel for the 3D city scene.
//
// Plain DOM, rendered as a SIBLING of <Canvas>. Appears whenever the
// user has clicked a building. Click is purely local until the user
// explicitly hits "Apply as filters", at which point the parent's
// onApplyFilters callback fires and the App-level filter state updates.
//
// No business logic here. The panel doesn't know anything about App
// state -- it just renders a record and forwards intent.

import {
  BOROUGH_NAMES,
  BOROUGH_PALETTE,
} from '../../utils/building-color';

// Mirrors the local LAND_USE_LABELS in App.js. Duplicated here (11
// entries) to avoid creating a new shared module just for this panel.
const LAND_USE_LABELS = {
  '1': 'One & Two Family',
  '2': 'Multi-Family Walk-Up',
  '3': 'Multi-Family Elevator',
  '4': 'Mixed Res/Commercial',
  '5': 'Commercial & Office',
  '6': 'Industrial & Mfg',
  '7': 'Transport & Utility',
  '8': 'Public Facilities',
  '9': 'Open Space',
  '10': 'Parking',
  '11': 'Vacant Land',
};

const fmt = (n) => (Number.isFinite(+n) ? Math.round(+n).toLocaleString() : 'N/A');

function Row({ label, value }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: 11,
        padding: '2px 0',
      }}
    >
      <span style={{ color: '#9a9cb0' }}>{label}</span>
      <span style={{ color: '#1a1a2e', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SelectionPanel({
  record,
  onApplyFilters,
  onClear,
  position = 'bottom-left',
}) {
  if (!record) return null;

  const anchor = {
    position: 'absolute',
    zIndex: 5,
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(6px)',
    border: '1px solid #ebedf2',
    borderRadius: 10,
    padding: '12px 14px',
    boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    minWidth: 240,
    maxWidth: 300,
  };
  if (position === 'bottom-left') Object.assign(anchor, { bottom: 16, left: 16 });
  else if (position === 'bottom-right') Object.assign(anchor, { bottom: 16, right: 16 });
  else if (position === 'top-left') Object.assign(anchor, { top: 16, left: 16 });
  else Object.assign(anchor, { top: 16, right: 16 });

  const boroughCode = record.borough;
  const boroughLabel = BOROUGH_NAMES[boroughCode] ?? boroughCode ?? 'N/A';
  const boroughColor = BOROUGH_PALETTE[boroughCode] ?? '#1a1a2e';

  const landuseCode =
    record.landuse != null && record.landuse !== ''
      ? String(Math.round(+record.landuse))
      : null;
  const landuseLabel = landuseCode
    ? LAND_USE_LABELS[landuseCode] ?? `Land Use ${landuseCode}`
    : 'N/A';

  const zoning = record.zonedist1 || 'N/A';
  const year =
    Number.isFinite(+record.yearbuilt) && +record.yearbuilt > 0
      ? record.yearbuilt
      : 'N/A';

  return (
    <div style={anchor}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#9a9cb0',
          }}
        >
          Selected Building
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#9a9cb0',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 2,
          }}
        >
          &times;
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: boroughColor,
            flexShrink: 0,
          }}
        />
        <strong
          style={{
            fontSize: 13,
            color: '#1a1a2e',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={record.address || 'Unknown address'}
        >
          {record.address || 'Unknown address'}
        </strong>
      </div>

      <Row label="Borough" value={boroughLabel} />
      <Row label="Land Use" value={landuseLabel} />
      <Row label="Zoning" value={zoning} />
      <Row label="Floors" value={fmt(record.numfloors)} />
      <Row label="Year" value={year} />
      <Row label="Area" value={`${fmt(record.bldgarea)} sqft`} />

      <button
        type="button"
        onClick={() => onApplyFilters?.(record)}
        style={{
          marginTop: 10,
          width: '100%',
          padding: '6px 10px',
          border: 'none',
          borderRadius: 8,
          background: '#1a1a2e',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.02em',
          cursor: 'pointer',
        }}
      >
        Apply as Filters
      </button>
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          color: '#9a9cb0',
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        Filters borough, land use, and zoning
      </div>
    </div>
  );
}

export default SelectionPanel;
