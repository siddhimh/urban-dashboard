//top bar descibing the details of dashboard
function TopBar({ totalBuildings }) {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-logo">UM</div>
        <div className="top-bar-title">
          <h1>Urban Morphology Dashboard</h1>
          <span>NYC Building Analytics &mdash; {totalBuildings} buildings across 5 boroughs</span>
        </div>
      </div>
    </div>
  );
}

export default TopBar;