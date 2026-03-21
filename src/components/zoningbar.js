import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { BOROUGH_PALETTE, BOROUGH_NAMES, BOROUGH_ORDER } from '../colors';

/* ── Human-readable zoning descriptions ─────────────────────────── */
const ZONING_INFO = {
  // Residential
  R1:  { short: "Single-Family",     desc: "Detached single-family homes, very low density" },
  R2:  { short: "Single-Family",     desc: "Detached single-family homes, low density" },
  R3:  { short: "Low-Rise Res.",     desc: "Low-rise residential: 1–2 family homes & small apartments" },
  R4:  { short: "Low-Rise Res.",     desc: "Low-rise residential: row houses & small apartments" },
  R5:  { short: "Low-Rise Res.",     desc: "Low-rise residential: row houses & small apartment buildings" },
  R6:  { short: "Mid-Rise Res.",     desc: "Medium-density residential: apartment buildings (6–14 stories)" },
  R7:  { short: "Mid-High Res.",     desc: "Medium-high density residential: high-rise apartments (12–16 stories)" },
  R8:  { short: "High-Rise Res.",    desc: "High-density residential: high-rise apartment towers (16+ stories)" },
  R9:  { short: "Tower Res.",        desc: "Very high-density residential towers" },
  R10: { short: "Highest Density",   desc: "Highest-density residential: supertall towers (Midtown, FiDi)" },
  // Commercial
  C1:  { short: "Local Retail",      desc: "Local commercial: small retail in residential areas" },
  C2:  { short: "Local Retail",      desc: "Local commercial: retail & service in residential areas" },
  C3:  { short: "Waterfront Comm.",  desc: "Waterfront recreation & commercial" },
  C4:  { short: "Commercial Ctr.",   desc: "Major commercial center: regional retail & offices" },
  C5:  { short: "Central Comm.",     desc: "Central commercial: office towers in business cores" },
  C6:  { short: "General Comm.",     desc: "General commercial: large offices, hotels & mixed-use" },
  C7:  { short: "Amusement",        desc: "Commercial amusement districts" },
  C8:  { short: "Heavy Comm.",       desc: "Heavy commercial: auto services, warehouses & general service" },
  // Manufacturing / Industrial
  M1:  { short: "Light Industrial",  desc: "Light manufacturing & industrial: offices, studios, warehouses" },
  M2:  { short: "Medium Industrial", desc: "Medium manufacturing & industrial" },
  M3:  { short: "Heavy Industrial",  desc: "Heavy manufacturing & industrial" },
  // Special
  PARK: { short: "Park",            desc: "Public park or open-space zone" },
  BPC:  { short: "Battery Park City", desc: "Battery Park City special district" },
};

/** Look up zoning info by code — tries exact base (e.g. R3-2 → R3) */
function zoningInfo(code) {
  if (!code) return { short: "Unknown", desc: code || "" };
  const upper = code.toUpperCase();
  // Try full match first (PARK, BPC, R10, R10A)
  if (ZONING_INFO[upper]) return ZONING_INFO[upper];
  // Strip suffix letters / dash-numbers: "R3-2" → "R3", "R6B" → "R6", "C6-2A" → "C6"
  const base = upper.replace(/[-][0-9A-Z]+$/, '').replace(/[A-Z]$/, '');
  if (ZONING_INFO[base]) return ZONING_INFO[base];
  // Fallback: first letter category
  if (upper.startsWith('R')) return { short: "Residential", desc: `Residential zone (${code})` };
  if (upper.startsWith('C')) return { short: "Commercial", desc: `Commercial zone (${code})` };
  if (upper.startsWith('M')) return { short: "Industrial", desc: `Manufacturing / industrial zone (${code})` };
  return { short: code, desc: code };
}

function ZoningBar({ sampleData, selected, onSelect }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!sampleData || !sampleData.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 6, right: 14, bottom: 54, left: 44 };
    const totalW = 400, totalH = 270;
    const width = totalW - margin.left - margin.right;
    const height = totalH - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${totalW} ${totalH}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Aggregate: count per zone per borough from sampleData
    const nested = d3.rollup(sampleData,
      v => v.length,
      d => d.zonedist1,
      d => d.borough
    );

    // Get top zones by total count
    const zoneTotals = Array.from(nested, ([zone, boroughMap]) => ({
      zone,
      total: d3.sum(Array.from(boroughMap.values()))
    })).sort((a, b) => b.total - a.total).slice(0, 10);

    const zones = zoneTotals.map(d => d.zone);
    const boroughs = BOROUGH_ORDER.filter(b =>
      zones.some(z => (nested.get(z)?.get(b) || 0) > 0)
    );

    // Build grouped data
    const groupedData = zones.map(zone => {
      const obj = { zone };
      boroughs.forEach(b => {
        obj[b] = nested.get(zone)?.get(b) || 0;
      });
      return obj;
    });

    // Scales
    const x0 = d3.scaleBand()
      .domain(zones)
      .range([0, width])
      .padding(0.2);

    const x1 = d3.scaleBand()
      .domain(boroughs)
      .range([0, x0.bandwidth()])
      .padding(0.06);

    const y = d3.scaleLinear()
      .domain([0, d3.max(groupedData, d => d3.max(boroughs, b => d[b]))])
      .nice()
      .range([height, 0]);

    // Tooltip (initialized early so x-axis hover can use it)
    let tooltip = d3.select(tooltipRef.current);
    if (tooltip.empty()) {
      tooltip = d3.select("body").append("div").attr("class", "d3-tooltip");
      tooltipRef.current = tooltip.node();
    }
    tooltip.style("opacity", 0);

    // Grid
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).tickSize(-width).tickFormat(""));

    // X axis — codes only, with hover tooltip for description
    const xAxisG = g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x0));

    xAxisG.selectAll("text")
      .attr("transform", "rotate(-35)")
      .style("text-anchor", "end")
      .style("font-size", "8px")
      .style("cursor", "default")
      .on("mouseover", function (event, zone) {
        const info = zoningInfo(zone);
        tooltip.style("opacity", 1)
          .html(`<strong>${zone}</strong><div style="color:#8a8c9e;font-size:11px;margin:2px 0 0">${info.desc}</div>`)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0);
      });

    // Y axis
    g.append("g")
      .call(d3.axisLeft(y).tickFormat(d3.format("~s")).ticks(5))
      .selectAll("text").style("font-size", "9px");

    g.append("text").attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2).attr("y", -38)
      .attr("text-anchor", "middle").style("font-size", "10px")
      .text("Buildings");

    // Grouped bars
    const zoneGroups = g.selectAll("g.zone-group")
      .data(groupedData)
      .enter()
      .append("g")
      .attr("class", "zone-group")
      .attr("transform", d => `translate(${x0(d.zone)},0)`);

    zoneGroups.selectAll("rect")
      .data(d => boroughs.map(b => ({ zone: d.zone, borough: b, value: d[b] })))
      .enter()
      .append("rect")
      .attr("class", d => `bar-clickable ${selected && selected !== d.zone ? 'dimmed' : ''}`)
      .attr("x", d => x1(d.borough))
      .attr("y", height)
      .attr("width", x1.bandwidth())
      .attr("height", 0)
      .attr("fill", d => BOROUGH_PALETTE[d.borough] || "#9a9cb0")
      .attr("rx", 2)
      .attr("opacity", d => selected && selected !== d.zone ? 0.15 : 0.85)
      .on("click", function (event, d) {
        onSelect(selected === d.zone ? null : d.zone);
      })
      .on("mouseover", function (event, d) {
        if (!selected || selected === d.zone) {
          d3.select(this).transition().duration(100).attr("opacity", 1);
        }
        const info = zoningInfo(d.zone);
        tooltip.style("opacity", 1)
          .html(`
            <strong>${d.zone}</strong> — ${BOROUGH_NAMES[d.borough] || d.borough}<br/>
            <div style="color:#8a8c9e;font-size:11px;margin:2px 0 4px">${info.desc}</div>
            <div class="tt-row"><span class="tt-label">Buildings</span><span class="tt-value">${d3.format(",")(d.value)}</span></div>
          `)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this).transition().duration(100)
          .attr("opacity", selected && selected !== d.zone ? 0.15 : 0.85);
        tooltip.style("opacity", 0);
      })
      .transition()
      .duration(600)
      .delay((d, i) => i * 25)
      .ease(d3.easeCubicOut)
      .attr("y", d => y(d.value))
      .attr("height", d => height - y(d.value));

    // Legend
    const legend = svg.append("g")
      .attr("transform", `translate(${margin.left + 4}, ${height + margin.top + 42})`);

    boroughs.forEach((b, i) => {
      const lg = legend.append("g")
        .attr("transform", `translate(${i * 72}, 0)`);
      lg.append("rect")
        .attr("width", 9).attr("height", 9).attr("rx", 2)
        .attr("fill", BOROUGH_PALETTE[b]);
      lg.append("text")
        .attr("x", 12).attr("y", 8)
        .style("font-size", "8px")
        .style("fill", "#6b6d82")
        .text(BOROUGH_NAMES[b] || b);
    });

    return () => {
      if (tooltipRef.current) d3.select(tooltipRef.current).style("opacity", 0);
    };
  }, [sampleData, selected, onSelect]);

  return <svg ref={svgRef}></svg>;
}

export default ZoningBar;
