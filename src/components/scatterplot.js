import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { BOROUGH_COLOR, BOROUGH_NAMES, BOROUGH_ORDER } from '../colors';

function ScatterPlot({ data, onBrush, brushRange }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 10, right: 18, bottom: 42, left: 50 };
    const totalW = 580, totalH = 370;
    const width = totalW - margin.left - margin.right;
    const height = totalH - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${totalW} ${totalH}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain(d3.extent(data, d => d.yearbuilt))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.numfloors)])
      .nice()
      .range([height, 0]);

    const size = d3.scaleSqrt()
      .domain([0, d3.max(data, d => d.bldgarea)])
      .range([1.5, 10]);

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
      .text("Year Built");

    g.append("text").attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2).attr("y", -36)
      .attr("text-anchor", "middle").style("font-size", "10px")
      .text("Number of Floors");

    // Tooltip
    if (!tooltipRef.current) {
      tooltipRef.current = d3.select("body").append("div")
        .attr("class", "d3-tooltip").node();
    }
    const tooltip = d3.select(tooltipRef.current).style("opacity", 0);

    // Circles with entrance animation
    const circles = g.selectAll("circle.dot")
      .data(data)
      .enter()
      .append("circle")
      .attr("class", "dot")
      .attr("cx", d => x(d.yearbuilt))
      .attr("cy", d => y(d.numfloors))
      .attr("r", 0)
      .attr("fill", d => BOROUGH_COLOR(d.borough))
      .attr("opacity", 0.5)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5);

    circles.transition()
      .duration(500)
      .delay((d, i) => Math.min(i * 0.2, 250))
      .attr("r", d => size(d.bldgarea));

    circles
      .on("mouseover", function (event, d) {
        d3.select(this)
          .transition().duration(120)
          .attr("opacity", 1)
          .attr("stroke", "#1a1a2e")
          .attr("stroke-width", 2)
          .attr("r", size(d.bldgarea) + 3);

        tooltip.style("opacity", 1)
          .html(`
            <strong>${d.address || "N/A"}</strong><br/>
            <div class="tt-row"><span class="tt-label">Borough</span><span class="tt-value">${BOROUGH_NAMES[d.borough]}</span></div>
            <div class="tt-row"><span class="tt-label">Year</span><span class="tt-value">${d.yearbuilt}</span></div>
            <div class="tt-row"><span class="tt-label">Floors</span><span class="tt-value">${d.numfloors}</span></div>
            <div class="tt-row"><span class="tt-label">Area</span><span class="tt-value">${d3.format(",")(d.bldgarea)} sqft</span></div>
          `)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px")
               .style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this)
          .transition().duration(120)
          .attr("opacity", 0.5)
          .attr("stroke", "#fff")
          .attr("stroke-width", 0.5)
          .attr("r", size(d.bldgarea));
        tooltip.style("opacity", 0);
      });

    // Brush for year selection
    const brush = d3.brushX()
      .extent([[0, 0], [width, height]])
      .on("end", (event) => {
        if (!event.selection) { onBrush(null); return; }
        const [x0, x1] = event.selection.map(x.invert);
        onBrush([Math.round(x0), Math.round(x1)]);
      });

    g.append("g").attr("class", "brush").call(brush);

    if (brushRange) {
      g.select(".brush").call(brush.move, [x(brushRange[0]), x(brushRange[1])]);
    }

    // Legend
    const legend = g.append("g")
      .attr("transform", `translate(${width - 105}, 5)`);

    legend.append("rect")
      .attr("x", -10).attr("y", -8)
      .attr("width", 115).attr("height", 108)
      .attr("rx", 8).attr("fill", "#fff")
      .attr("stroke", "#ebedf2").attr("opacity", 0.9);

    BOROUGH_ORDER.forEach((b, i) => {
      const row = legend.append("g").attr("transform", `translate(4, ${i * 19 + 6})`);
      row.append("circle").attr("r", 4).attr("fill", BOROUGH_COLOR(b));
      row.append("text").attr("x", 10).attr("y", 4)
        .style("font-size", "10px").style("fill", "#6b6d82")
        .text(BOROUGH_NAMES[b]);
    });

    return () => { tooltip.style("opacity", 0); };
  }, [data, brushRange, onBrush]);

  return <svg ref={svgRef}></svg>;
}

export default ScatterPlot;
