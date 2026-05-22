// Borough color legend for the 3D city scene.
//
// Plain DOM component -- rendered as a SIBLING of <Canvas>, NOT inside
// it. Reuses the existing `.legend-item` / `.legend-dot` classes from
// App.css so it visually matches every legend in the 2D dashboard.
//
// No state. No interactions yet (clickable filtering can be added later
// by wiring this to App's `toggleBorough`).

import {
  BOROUGH_ORDER,
  BOROUGH_NAMES,
  BOROUGH_PALETTE,
} from '../../utils/building-color';

function Legend3D({ position = 'top-right' }) {
  // Anchor by absolute position inside the 3D view container.
  const anchorStyle = {
    position: 'absolute',
    zIndex: 5,
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(6px)',
    border: '1px solid #ebedf2',
    borderRadius: 10,
    padding: '10px 12px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    pointerEvents: 'auto',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  };

  // Corner offsets.
  if (position === 'top-right') {
    anchorStyle.top = 16;
    anchorStyle.right = 16;
  } else if (position === 'top-left') {
    anchorStyle.top = 16;
    anchorStyle.left = 16;
  } else if (position === 'bottom-left') {
    anchorStyle.bottom = 16;
    anchorStyle.left = 16;
  } else {
    anchorStyle.bottom = 16;
    anchorStyle.right = 16;
  }

  return (
    <div className="legend-3d" style={anchorStyle}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#9a9cb0',
          marginBottom: 6,
        }}
      >
        Borough
      </div>

      <div
        className="chart-legend"
        style={{ flexDirection: 'column', gap: 4, marginTop: 0 }}
      >
        {BOROUGH_ORDER.map((b) => (
          <div key={b} className="legend-item" style={{ fontSize: 11 }}>
            <span
              className="legend-dot"
              style={{ background: BOROUGH_PALETTE[b] }}
            />
            <span style={{ color: '#1a1a2e', fontWeight: 500 }}>
              {BOROUGH_NAMES[b]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Legend3D;
