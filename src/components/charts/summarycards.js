import * as d3 from 'd3';

function SummaryCards({ data, total, fullStats }) {
  if (!data.length) return null;

  const fmt = d3.format(",");
  const fmtDec = d3.format(",.1f");
  const fmtArea = d3.format(",.0f");
  const fs = fullStats; // shorthand

  // Are any cross-filters active?
  const isFiltered = data.length !== total;

  // Filtered-view values (computed from the currently displayed sample subset)
  const filtAvgFloors = d3.mean(data, d => d.numfloors);
  const filtMaxFloors = d3.max(data, d => d.numfloors);
  const filtAvgBldg   = d3.mean(data, d => d.bldgarea);
  const filtAvgLot    = d3.mean(data, d => d.lotarea);
  const filtYearMin   = d3.min(data, d => d.yearbuilt);
  const filtYearMax   = d3.max(data, d => d.yearbuilt);
  const filtZones     = new Set(data.map(d => d.zonedist1)).size;

  const stats = [
    {
      icon: "\u{1F3D7}",
      label: "Total Buildings",
      // Always show the true full-dataset count
      value: fs ? fmt(fs.total_buildings) : fmt(total),
      sub: fs ? "across all 5 boroughs" : "",
      colorClass: "card-color-coral"
    },
    {
      icon: "\u{1F4CA}",
      label: "Avg Floors",
      // Show filtered avg when filters active, otherwise full-dataset avg
      value: isFiltered ? fmtDec(filtAvgFloors) : (fs ? fmtDec(fs.avg_floors) : fmtDec(filtAvgFloors)),
      sub: isFiltered
        ? `Overall: ${fs ? fmtDec(fs.avg_floors) : "–"} · max ${fmt(filtMaxFloors)}`
        : (fs ? `median ${fmtDec(fs.median_floors)} · max ${fmt(fs.max_floors)}` : `max ${fmt(filtMaxFloors)}`),
      colorClass: "card-color-blue"
    },
    {
      icon: "\u{1F3E2}",
      label: "Avg Bldg Area",
      value: isFiltered ? fmtArea(filtAvgBldg) + " sqft" : (fs ? fmtArea(fs.avg_bldgarea) + " sqft" : fmtArea(filtAvgBldg) + " sqft"),
      sub: isFiltered
        ? `Overall: ${fs ? fmtArea(fs.avg_bldgarea) : "–"} sqft`
        : "",
      colorClass: "card-color-green"
    },
    {
      icon: "\u{1F4CD}",
      label: "Avg Lot Area",
      value: isFiltered ? fmtArea(filtAvgLot) + " sqft" : (fs ? fmtArea(fs.avg_lotarea) + " sqft" : fmtArea(filtAvgLot) + " sqft"),
      sub: isFiltered
        ? `Overall: ${fs ? fmtArea(fs.avg_lotarea) : "–"} sqft`
        : "",
      colorClass: "card-color-purple"
    },
    {
      icon: "\u{1F4C5}",
      label: "Year Range",
      value: isFiltered ? `${filtYearMin}\u2013${filtYearMax}` : (fs ? `${fs.oldest_year}\u2013${fs.newest_year}` : `${filtYearMin}\u2013${filtYearMax}`),
      sub: isFiltered
        ? `Overall: ${fs ? `${fs.oldest_year}\u2013${fs.newest_year}` : "–"}`
        : `${fs ? fmt(fs.total_buildings) + " buildings' span" : ""}`,
      colorClass: "card-color-teal"
    },
    {
      icon: "\u{1F3D8}",
      label: "Zoning Types",
      // Always show full-dataset count for total types
      value: fs ? fmt(fs.total_zoning_types) : fmt(filtZones),
      sub: isFiltered
        ? `${fmt(filtZones)} in current filter`
        : `across ${fs ? fmt(fs.total_landuse_types) : "–"} land use types`,
      colorClass: "card-color-amber"
    }
  ];

  return (
    <div className="summary-cards">
      {stats.map((s, i) => (
        <div key={i} className={`summary-card ${s.colorClass}`}>
          <div className="card-accent"></div>
          <div className="card-icon">{s.icon}</div>
          <div className="card-info">
            <div className="card-label">{s.label}</div>
            <div className="card-value">{s.value}</div>
            {s.sub && <div className="card-sub">{s.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default SummaryCards;
