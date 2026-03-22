import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { BOROUGH_COLOR, BOROUGH_NAMES, BOROUGH_ORDER } from '../../colors';

function TrendLine({ data, selectedBoroughs }) {
  const svgRef = useRef();
  const tooltipRef = useRef();
  const [hiddenBoroughs, setHiddenBoroughs] = useState(new Set());

  const toggleBorough = (b) => {
    setHiddenBoroughs(prev => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 8, right: 16, bottom: 40, left: 48 };
    const totalW = 400, totalH = 260;
    const width = totalW - margin.left - margin.right;
    const height = totalH - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${totalW} ${totalH}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const parsed = data.map(d => ({
      decade: +d.decade,
      borough: d.borough,
      median_floors: +d.median_floors
    }));

    const grouped = d3.group(parsed, d => d.borough);

    const x = d3.scaleLinear()
      .domain(d3.extent(parsed, d => d.decade))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(parsed, d => d.median_floors)])
      .nice()
      .range([height, 0]);

    // Grid
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).tickSize(-width).tickFormat(""));

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(8))
      .selectAll("text").style("font-size", "10px");

    g.append("g")
      .call(d3.axisLeft(y).ticks(6))
      .selectAll("text").style("font-size", "10px");

    g.append("text").attr("class", "axis-label")
      .attr("x", width / 2).attr("y", height + 32)
      .attr("text-anchor", "middle").style("font-size", "10px")
      .text("Decade");

    g.append("text").attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2).attr("y", -36)
      .attr("text-anchor", "middle").style("font-size", "10px")
      .text("Median Floors");

    // Tooltip
    let tooltip = d3.select(tooltipRef.current);
    if (tooltip.empty()) {
      tooltip = d3.select("body").append("div").attr("class", "d3-tooltip");
      tooltipRef.current = tooltip.node();
    }
    tooltip.style("opacity", 0);

    const line = d3.line()
      .x(d => x(d.decade))
      .y(d => y(d.median_floors))
      .curve(d3.curveMonotoneX);

    grouped.forEach((values, borough) => {
      if (hiddenBoroughs.has(borough)) return;

      const sorted = values.sort((a, b) => a.decade - b.decade);
      const isHighlighted = selectedBoroughs.size === 0 || selectedBoroughs.has(borough);

      // Animated line
      const path = g.append("path")
        .datum(sorted)
        .attr("fill", "none")
        .attr("stroke", BOROUGH_COLOR(borough))
        .attr("stroke-width", isHighlighted ? 2.5 : 1.5)
        .attr("opacity", isHighlighted ? 1 : 0.2)
        .attr("d", line);

      const totalLength = path.node().getTotalLength();
      path
        .attr("stroke-dasharray", totalLength)
        .attr("stroke-dashoffset", totalLength)
        .transition().duration(1000).ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);

      // Dots
      g.selectAll(`.dot-${borough}`)
        .data(sorted)
        .enter()
        .append("circle")
        .attr("cx", d => x(d.decade))
        .attr("cy", d => y(d.median_floors))
        .attr("r", 0)
        .attr("fill", BOROUGH_COLOR(borough))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .attr("opacity", isHighlighted ? 1 : 0.2)
        .transition().delay(800).duration(400)
        .attr("r", isHighlighted ? 4 : 3);

      // Tooltip on dots
      g.selectAll(`.dot-${borough}`)
        .data(sorted)
        .enter()
        .append("circle")
        .attr("cx", d => x(d.decade))
        .attr("cy", d => y(d.median_floors))
        .attr("r", 12)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("mouseover", function (event, d) {
          tooltip.style("opacity", 1)
            .html(`
              <strong>${BOROUGH_NAMES[d.borough]}</strong><br/>
              <div class="tt-row"><span class="tt-label">Decade</span><span class="tt-value">${d.decade}s</span></div>
              <div class="tt-row"><span class="tt-label">Median Floors</span><span class="tt-value">${d.median_floors}</span></div>
            `)
            .style("left", (event.pageX + 14) + "px")
            .style("top", (event.pageY - 14) + "px");
        })
        .on("mousemove", function (event) {
          tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
        })
        .on("mouseout", function () {
          tooltip.style("opacity", 0);
        });
    });

    return () => {
      if (tooltipRef.current) d3.select(tooltipRef.current).style("opacity", 0);
    };
  }, [data, hiddenBoroughs, selectedBoroughs]);

  return (
    <div className="chart-wrapper">
      <svg ref={svgRef}></svg>
      <div className="chart-legend">
        {BOROUGH_ORDER.map(b => (
          <span
            key={b}
            className={`legend-item ${hiddenBoroughs.has(b) ? 'dimmed' : ''}`}
            onClick={() => toggleBorough(b)}
          >
            <span className="legend-dot" style={{ background: BOROUGH_COLOR(b) }}></span>
            {BOROUGH_NAMES[b]}
          </span>
        ))}
      </div>
    </div>
  );
}

export default TrendLine;
