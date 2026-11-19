const d3 = window.d3;
const years = d3.range(2002, 2026);
const months = d3.range(1, 13);
const shortMonth = d3.utcFormat("%b");
const monthName = d3.utcFormat("%B");
const fixed = d3.format(".2f");
const signed = d3.format("+.2f");
const monthDate = (year, month) => new Date(Date.UTC(year, month - 1, 1));

function summarizeMonths(archive) {
  const first = new Date(archive.first + "T00:00:00Z");
  const groups = d3.group(
    archive.days.flatMap((row, index) => row && Number.isFinite(row[0])
      ? [{ date: d3.utcDay.offset(first, index), area: row[0], temperature: row[1] }]
      : []),
    ({ date }) => date.getUTCFullYear(),
    ({ date }) => date.getUTCMonth() + 1,
  );
  const rows = years.map((year) => months.map((month) => {
    const days = groups.get(year)?.get(month) ?? [];
    return {
      year, month, count: days.length,
      area: d3.median(days, (day) => day.area),
      temperature: d3.median(days, (day) => day.temperature),
    };
  }));

  for (const [index] of months.entries()) {
    const column = rows.map((row) => row[index]);
    const baseline = d3.median(column, (cell) => cell.area);
    for (const cell of column) {
      cell.anomaly = cell.area === undefined ? undefined : cell.area - baseline;
    }
  }
  return rows;
}

function describe(cell) {
  const period = `${monthName(monthDate(cell.year, cell.month))} ${cell.year}`;
  if (cell.area === undefined) return `${period} · No daily area summaries`;
  return `${period} · ${fixed(cell.area)} million km² · ${cell.count} ${cell.count === 1 ? "day" : "days"}`;
}

function periodMean(data, first, last, measure) {
  return d3.mean(data.filter(({ year }) => year >= first && year <= last), measure);
}

function describeChange(data, month) {
  const name = monthName(monthDate(2002, month));
  const early = periodMean(data, 2002, 2007, (cell) => cell.area);
  const recent = periodMean(data, 2020, 2025, (cell) => cell.area);
  const takeaway = document.querySelector("#monthly-takeaway");
  takeaway.textContent = "";
  if (early > 0 && Number.isFinite(recent)) {
    const change = d3.format(".0%")(Math.abs(recent / early - 1));
    const direction = recent < early ? "lower" : "higher";
    takeaway.textContent =
      `The mean of the yearly ${name} medians was ${change} ${direction} in 2020–2025 (${fixed(recent)} million km²) than in 2002–2007 (${fixed(early)} million km²).`;
  }

  const tempChange = periodMean(data, 2020, 2025, (cell) => cell.temperature) -
    periodMean(data, 2002, 2007, (cell) => cell.temperature);
  const context = document.querySelector("#temperature-context");
  context.textContent = Number.isFinite(tempChange)
    ? `The same ${name} comparison for temperature gives ${signed(tempChange)} °C among observed ice pixels. The set of pixels with temperature retrievals changes over time, so this is exploratory.`
    : "";
}

export function createTrends({ archive, onSelect }) {
  const rows = summarizeMonths(archive);
  const plot = drawMonthTrend(rows, onSelect);
  const heatmap = drawHeatmap(rows, onSelect);
  let activeMonth;
  return {
    setDate(date) {
      const key = date.slice(0, 7);
      if (key === activeMonth) return;
      activeMonth = key;
      const year = +date.slice(0, 4);
      const month = +date.slice(5, 7);
      plot.setSelection(year, month);
      heatmap.setSelection(year, month);
    },
  };
}

function drawMonthTrend(rows, onSelect) {
  const picker = d3.select("#trend-month");
  picker.selectAll("option").data(months).join("option")
    .attr("value", (month) => month).text((month) => monthName(monthDate(2002, month)));
  const svg = d3.select("#month-trend");
  const xAxis = svg.append("g").attr("class", "trend-axis");
  const yAxis = svg.append("g").attr("class", "trend-axis trend-y-axis");
  const line = svg.append("path").attr("class", "trend-line");
  const marks = svg.append("g");
  const annotation = svg.append("text").attr("class", "record-label");
  const labels = document.querySelector("#month-trend-detail");
  let width;
  let month;
  let data;
  let low;
  let points;
  let activeYear;
  let activeMonth;

  function showMonth(next) {
    if (next === month) return;
    month = next;
    data = rows.map((row) => row[month - 1]);
    low = month === 9 ? data.find((cell) => cell.year === 2012 && cell.area !== undefined) : null;
    picker.property("value", month);
    svg.attr("aria-label", `${monthName(monthDate(2002, month))} detected ice area by year`);
    annotation.text(low ? `2012 low · ${fixed(low.area)}` : "");
    describeChange(data, month);
    points = marks.selectAll("g").data(data.filter((cell) => cell.area !== undefined), (cell) => cell.year)
      .join((enter) => {
        const point = enter.append("g").attr("class", "trend-point").attr("role", "button")
          .on("pointerenter", (_, cell) => { labels.textContent = describe(cell); })
          .on("focus", function(_, cell) {
            points.attr("tabindex", -1);
            this.setAttribute("tabindex", 0);
            labels.textContent = describe(cell);
          })
          .on("click", (_, cell) => onSelect(cell.year, cell.month))
          .on("keydown", function(event, cell) {
            const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
            if (offset) {
              event.preventDefault();
              const nodes = points.nodes();
              nodes[nodes.indexOf(this) + offset]?.focus();
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(cell.year, cell.month);
            }
          });
        point.append("circle").attr("r", 10).attr("class", "trend-hit");
        point.append("circle").attr("r", 4).attr("class", "trend-dot");
        point.append("title");
        return point;
      })
      .attr("aria-label", describe)
      .classed("record-low", (cell) => cell === low);
    points.select("title").text(describe);
    render();
  }

  function render() {
    if (!width) return;
    const height = 248;
    const left = 39;
    const right = width - 17;
    const bottom = height - 31;
    const x = d3.scaleLinear([2002, 2025], [left, right]);
    const y = d3.scaleLinear([0, (d3.max(data, (cell) => cell.area) || 1) * 1.08],
      [bottom, 12]).nice(4);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const ticks = width < 410 ? [2002, 2008, 2014, 2020, 2025] : [2002, 2006, 2010, 2014, 2018, 2022, 2025];
    xAxis.attr("transform", `translate(0,${bottom})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.format("d")).tickSizeOuter(0));
    yAxis.attr("transform", `translate(${left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(left - right).tickFormat(y.tickFormat(4, "~f")));
    line.attr("d", d3.line().defined((cell) => cell.area !== undefined)
      .x(({ year }) => x(year)).y(({ area }) => y(area))(data));
    points.attr("transform", ({ year, area }) => `translate(${x(year)},${y(area)})`);
    if (low) annotation.attr("x", x(low.year)).attr("y", y(low.area) + 19);
  }

  function highlight() {
    const selected = activeMonth === month ? data.find((cell) => cell.year === activeYear) : null;
    points.attr("aria-pressed", (cell) => cell === selected)
      .attr("tabindex", (cell, index) => (selected?.area !== undefined ? cell === selected : index === 0) ? 0 : -1);
    const detail = selected ?? low;
    labels.textContent = detail ? describe(detail)
      : points.empty() ? "No daily area summaries for this month." : "Select a year to see its daily map.";
  }

  picker.on("change", (event) => {
    showMonth(+event.target.value);
    highlight();
  });
  new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    render();
  }).observe(svg.node());

  return {
    setSelection(year, month) {
      activeYear = year;
      activeMonth = month;
      showMonth(month);
      highlight();
    },
  };
}

function drawHeatmap(rows, onSelect) {
  const table = d3.select("#season-heatmap");
  const mode = document.querySelector("#heatmap-mode");
  const detail = document.querySelector("#heatmap-detail");
  const method = document.querySelector("#heatmap-method");
  const gradient = document.querySelector("#heatmap-gradient");
  const legend = d3.select("#heatmap-labels");
  const cells = rows.flat();
  const maximum = d3.max(cells, (cell) => cell.area) || 1;
  const difference = d3.max(cells, (cell) => Math.abs(cell.anomaly)) || 1;
  let selected;

  table.select("thead").append("tr").selectAll("th")
    .data(["Year", ...months.map((month) => shortMonth(monthDate(2002, month)))])
    .join("th").attr("scope", "col").text((label) => label);
  const tr = table.select("tbody").selectAll("tr").data(rows).join("tr");
  tr.append("th").attr("scope", "row").text((row) => row[0].year);
  const buttons = tr.selectAll("td").data((row) => row).join("td").append("button")
    .attr("type", "button").attr("tabindex", -1).classed("missing", (cell) => cell.area === undefined)
    .on("pointerenter", (_, cell) => showCell(cell))
    .on("focus", function(_, cell) {
      buttons.attr("tabindex", -1);
      this.setAttribute("tabindex", 0);
      showCell(cell);
    })
    .on("click", (_, cell) => onSelect(cell.year, cell.month))
    .on("keydown", function(event, cell) {
      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -months.length, ArrowDown: months.length }[event.key];
      if (!offset) return;
      event.preventDefault();
      if ((offset === -1 && cell.month === months[0]) || (offset === 1 && cell.month === months.at(-1))) return;
      buttons.nodes()[cells.indexOf(cell) + offset]?.focus();
    });

  function label(cell) {
    const text = describe(cell);
    return mode.value === "anomaly" && cell.anomaly !== undefined
      ? `${text} · ${signed(cell.anomaly)} million km² from the monthly baseline` : text;
  }

  function showCell(cell) {
    detail.textContent = cell ? label(cell) : "Select a cell to open its daily map.";
  }

  function renderMode() {
    const anomaly = mode.value === "anomaly";
    const domain = anomaly ? [-difference, 0, difference] : [0, maximum];
    const color = anomaly ? d3.scaleDiverging(domain, d3.interpolateRdBu)
      : d3.scaleSequential(domain, d3.interpolateGnBu);
    const measure = anomaly ? "anomaly" : "area";
    buttons.style("--heat-color", (cell) => cell[measure] === undefined ? null : color(cell[measure]))
      .attr("title", label).attr("aria-label", label);
    gradient.style.background = `linear-gradient(to right, ${d3.quantize(
      (t) => color(domain[0] * (1 - t) + domain.at(-1) * t), 13,
    ).join(", ")})`;
    legend.selectAll("span").data(domain).join("span")
      .text((value) => value === 0 ? "0" : (anomaly ? signed(value) : fixed(value)));
    method.textContent = anomaly
      ? "Difference from the 2002–2025 median of the yearly values for that calendar month, in million km²."
      : "Median daily detected area, in million km².";
    showCell(selected);
  }

  mode.addEventListener("change", renderMode);
  renderMode();
  return {
    setSelection(year, month) {
      selected = cells.find((cell) => cell.year === year && cell.month === month);
      buttons.attr("aria-pressed", (cell) => cell === selected)
        .attr("tabindex", (cell) => cell === (selected ?? cells[0]) ? 0 : -1);
      showCell(selected);
    },
  };
}
