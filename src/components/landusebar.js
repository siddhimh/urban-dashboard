import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { DIVERGING_INTERPOLATOR } from '../colors';

const LAND_USE_LABELS = {
  "1": "One & Two Family",
  "2": "Multi-Family Walk-Up",
  "3": "Multi-Family Elevator",
  "4": "Mixed Res/Commercial",
  "5": "Commercial & Office",
  "6": "Industrial & Mfg",
  "7": "Transport & Utility",
  "8": "Public Facilities",
  "9": "Open Space",
  "10": "Parking",
  "11": "Vacant Land"
};

// Generate 11 evenly-spaced colors from the diverging ramp
const BAR_COLORS = d3.scaleOrdinal()
  .range(d3.range(11).map(i => DIVERGING_INTERPOLATOR(i / 10)));

function LandUseBar({ data, selected, onSelect }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 6, right: 28, bottom: 24, left: 120 };
    const totalW = 400, totalH = 270;
    const width = totalW - margin.left - margin.right;
    const height = totalH - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${totalW} ${totalH}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const parsed = data.map(d => ({
      landuse: String(Math.round(+d.landuse)),
      count: +d.count,
      avg_floors: +d.avg_floors,
      avg_bldgarea: +d.avg_bldgarea
    })).sort((a, b) => a.avg_floors - b.avg_floors);

    const y = d3.scaleBand()
      .domain(parsed.map(d => d.landuse))
      .range([height, 0])
      .padding(0.22);

    const x = d3.scaleLinear()
      .domain([0, d3.max(parsed, d => d.avg_floors) * 1.1])
      .nice()
      .range([0, width]);

    // Grid
    g.append("g").attr("class", "grid")
      .call(d3.axisBottom(x).tickSize(height).tickFormat(""))
      .attr("transform", `translate(0,0)`);

    // Y axis – land use labels
    g.append("g")
      .call(d3.axisLeft(y).tickFormat(d => LAND_USE_LABELS[d] || d))
      .selectAll("text")
      .style("font-size", "9px");

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".1f")))
      .selectAll("text").style("font-size", "9px");

    g.append("text").attr("class", "axis-label")
      .attr("x", width / 2).attr("y", height + 26)
      .attr("text-anchor", "middle").style("font-size", "10px")
      .text("Avg. Number of Floors");

    // Tooltip
    let tooltip = d3.select(tooltipRef.current);
    if (tooltip.empty()) {
      tooltip = d3.select("body").append("div").attr("class", "d3-tooltip");
      tooltipRef.current = tooltip.node();
    }
    tooltip.style("opacity", 0);

    // Bars (horizontal)
    g.selectAll("rect.bar")
      .data(parsed)
      .enter()
      .append("rect")
      .attr("class", d => `bar-clickable ${selected && selected !== d.landuse ? 'dimmed' : ''}`)
      .attr("x", 0)
      .attr("y", d => y(d.landuse))
      .attr("width", 0)
      .attr("height", y.bandwidth())
      .attr("fill", (d, i) => BAR_COLORS(i))
      .attr("rx", 3)
      .attr("opacity", d => selected && selected !== d.landuse ? 0.2 : 0.85)
      .on("click", function (event, d) {
        onSelect(selected === d.landuse ? null : d.landuse);
      })
      .on("mouseover", function (event, d) {
        if (!selected || selected === d.landuse) {
          d3.select(this).transition().duration(100).attr("opacity", 1);
        }
        tooltip.style("opacity", 1)
          .html(`
            <strong>${LAND_USE_LABELS[d.landuse] || d.landuse}</strong><br/>
            <div class="tt-row"><span class="tt-label">Avg Floors</span><span class="tt-value">${d.avg_floors.toFixed(1)}</span></div>
            <div class="tt-row"><span class="tt-label">Count</span><span class="tt-value">${d3.format(",")(d.count)}</span></div>
            <div class="tt-row"><span class="tt-label">Avg Area</span><span class="tt-value">${d3.format(",")(Math.round(d.avg_bldgarea))} sqft</span></div>
          `)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this).transition().duration(100)
          .attr("opacity", selected && selected !== d.landuse ? 0.2 : 0.85);
        tooltip.style("opacity", 0);
      })
      .transition()
      .duration(600)
      .delay((d, i) => i * 50)
      .ease(d3.easeCubicOut)
      .attr("width", d => x(d.avg_floors));

    // Value labels at end of bars
    g.selectAll("text.val-label")
      .data(parsed)
      .enter()
      .append("text")
      .attr("class", "val-label")
      .attr("x", d => x(d.avg_floors) + 4)
      .attr("y", d => y(d.landuse) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .style("font-size", "8px")
      .style("fill", "#6b6d82")
      .style("opacity", 0)
      .text(d => d.avg_floors.toFixed(1))
      .transition()
      .duration(600)
      .delay((d, i) => i * 50 + 300)
      .style("opacity", 1);

    return () => {
      if (tooltipRef.current) d3.select(tooltipRef.current).style("opacity", 0);
    };
  }, [data, selected, onSelect]);

  return <svg ref={svgRef}></svg>;
}

export default LandUseBar;
