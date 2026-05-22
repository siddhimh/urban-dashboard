//top bar descibing the details of dashboard
function TopBar({ totalBuildings, activeView, setActiveView }) {
  const showToggle = typeof setActiveView === 'function';

  const toggleBtnStyle = (isActive) => ({
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    border: '1px solid #d0d2e0',
    background: isActive ? '#1a1a2e' : '#fff',
    color: isActive ? '#fff' : '#1a1a2e',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  });

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-logo">UM</div>
        <div className="top-bar-title">
          <h1>Urban Morphology Dashboard</h1>
          <span>NYC Building Analytics &mdash; {totalBuildings} buildings across 5 boroughs</span>
        </div>
      </div>

      {showToggle && (
        <div className="top-bar-right">
          <div
            className="view-toggle"
            role="group"
            aria-label="View mode"
            style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }}
          >
            <button
              type="button"
              onClick={() => setActiveView('2D')}
              style={{ ...toggleBtnStyle(activeView === '2D'), borderRadius: '6px 0 0 6px' }}
              aria-pressed={activeView === '2D'}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setActiveView('3D')}
              style={{ ...toggleBtnStyle(activeView === '3D'), borderLeft: 'none', borderRadius: '0 6px 6px 0' }}
              aria-pressed={activeView === '3D'}
            >
              3D
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TopBar;
