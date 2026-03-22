//main layout of the dashboard
import * as d3 from "d3";
import SummaryCards from "../charts/summarycards";
import ScatterPlot from "../charts/scatterplot";
import TrendLine from "../charts/trendline";
import LandUseBar from "../charts/landusebar";
import ZoningBar from "../charts/zoningbar";
import DotMap from "../charts/dotmap";
import TopBar from "./topbar";
import FiltersBar from "./filtersbar";

function DashboardLayout({
  fullStats,
  sampleData,
  selectedBoroughs,
  toggleBorough,
  activeFilters,
  clearFilter,
  clearAll,
  filteredData,
  brushRange,
  setBrushRange,
  trendComputed,
  landUseComputed,
  selectedLandUse,
  setSelectedLandUse,
  dataForZoning,
  selectedZoning,
  setSelectedZoning,
}) {
  return (
    <div className="app">
      <TopBar
        totalBuildings={d3.format(",")(
          fullStats ? fullStats.total_buildings : sampleData.length
        )}
      />

      <FiltersBar
        selectedBoroughs={selectedBoroughs}
        toggleBorough={toggleBorough}
        activeFilters={activeFilters}
        clearFilter={clearFilter}
        clearAll={clearAll}
      />

      <div className="main-content">
        <SummaryCards
          data={filteredData}
          total={sampleData.length}
          fullStats={fullStats}
        />

        {/* First row: detailed point-based views */}
        <div className="dashboard-row row-equal">
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Year Built vs Number of Floors</h3>
                <div className="chart-subtitle">
                  Brush to select a year range. Size = building area, color = borough.
                </div>
              </div>
            </div>
            <ScatterPlot
              data={filteredData}
              onBrush={setBrushRange}
              brushRange={brushRange}
            />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Geographic Distribution</h3>
                <div className="chart-subtitle">
                  Each dot is a building. Color = number of floors.
                </div>
              </div>
            </div>
            <DotMap data={filteredData} />
          </div>
        </div>

        {/* Second row: aggregated trend and category comparisons */}
        <div className="dashboard-row row-three">
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Building Height Trends</h3>
                <div className="chart-subtitle">
                  Median floors per decade. Click legend to toggle.
                </div>
              </div>
            </div>
            <TrendLine
              data={trendComputed}
              selectedBoroughs={selectedBoroughs}
            />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Avg Floors by Land Use</h3>
                <div className="chart-subtitle">
                  Horizontal bars sorted by avg floors. Click to filter.
                </div>
              </div>
            </div>
            <LandUseBar
              data={landUseComputed}
              selected={selectedLandUse}
              onSelect={setSelectedLandUse}
            />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Zoning by Borough</h3>
                <div className="chart-subtitle">
                  Top 10 zones by borough. R = Residential · C = Commercial · M = Industrial
                </div>
              </div>
            </div>
            <ZoningBar
              sampleData={dataForZoning}
              selected={selectedZoning}
              onSelect={setSelectedZoning}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardLayout;