// Active-filters bar for the 3D city scene.
//
// Plain DOM, rendered as a SIBLING of <Canvas>. Card shell matches the
// other floating panels (rounded white, subtle shadow, small uppercase
// header) but lays the filters out HORIZONTALLY as compact pills so the
// bar stays narrow and out of the way of the scene.
//
// Stateless. Receives the same `activeFilters` array, `clearFilter`,
// and `clearAll` that App.js already builds for the 2D view; clicking
// a pill (or its ×) strips that one filter.

const KEY_LABELS = {
  borough: 'Borough',
  landuse: 'Land Use',
  zoning: 'Zoning',
  brush: 'Year',
};

function ActiveFilters3D({
  activeFilters = [],
  clearFilter,
  clearAll,
  position = 'top-center',
}) {
  if (!activeFilters || activeFilters.length === 0) return null;

  const anchor = {
    position: 'absolute',
    zIndex: 5,
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(6px)',
    border: '1px solid #ebedf2',
    borderRadius: 10,
    padding: '8px 12px',
    boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    maxWidth: 'calc(100% - 32px)',
  };

  if (position === 'top-center') {
    anchor.top = 16;
    anchor.left = '50%';
    anchor.transform = 'translateX(-50%)';
  } else if (position === 'top-left') {
    anchor.top = 16;
    anchor.left = 16;
  } else if (position === 'top-right') {
    anchor.top = 16;
    anchor.right = 16;
  } else if (position === 'bottom-center') {
    anchor.bottom = 16;
    anchor.left = '50%';
    anchor.transform = 'translateX(-50%)';
  }

  // Inline header label so the bar reads as "what is this row?" without
  // taking a second line of vertical space.
  const headerStyle = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#9a9cb0',
    flexShrink: 0,
  };

  const pillStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 14,
    background: '#f4f5f9',
    border: '1px solid #ebedf2',
    fontSize: 11,
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease',
  };

  const clearBtnStyle = {
    padding: '4px 10px',
    border: '1px solid #ebedf2',
    borderRadius: 14,
    background: '#fff',
    color: '#1a1a2e',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div style={anchor}>
      <span style={headerStyle}>Active Filters</span>

      {activeFilters.map((filter) => (
        <span
          key={filter.key}
          onClick={() => clearFilter?.(filter.key)}
          title="Click to remove this filter"
          style={pillStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#eef0f6';
            e.currentTarget.style.borderColor = '#dcdfe8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#f4f5f9';
            e.currentTarget.style.borderColor = '#ebedf2';
          }}
        >
          <span style={{ color: '#9a9cb0' }}>
            {KEY_LABELS[filter.key] ?? filter.key}:
          </span>
          <span style={{ color: '#1a1a2e', fontWeight: 600 }}>
            {filter.label}
          </span>
          <span style={{ color: '#9a9cb0', fontSize: 13, lineHeight: 1 }}>
            &times;
          </span>
        </span>
      ))}

      <button type="button" onClick={clearAll} style={clearBtnStyle}>
        Clear All
      </button>
    </div>
  );
}

export default ActiveFilters3D;
