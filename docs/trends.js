const d3 = window.d3;
const years = d3.range(2002, 2026);
const months = d3.range(1, 13);
const shortMonth = d3.utcFormat("%b");
const monthName = d3.utcFormat("%B");
const fixed = d3.format(".2f");
const signed = d3.format("+.2f");
const monthDate = (year, month) => new Date(Date.UTC(year, month - 1, 1));

const monthColors = d3.scaleOrdinal(months, [
  "#1d5aaa", "#287f9d", "#00877e", "#3e782e", "#758214", "#a97400",
  "#d15d22", "#bc3e42", "#ad397d", "#8344a1", "#5f56b4", "#435b75",
]);
const nameOfMonth = (month) => monthName(monthDate(2002, month));

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
  describeChange(rows.map((row) => row[8]), 9);
  drawMonthTrend(rows, onSelect);
  drawHeatmap(rows, onSelect);
}

function drawMonthTrend(rows, onSelect) {
  const svg = d3.select("#month-trend");
  const xAxis = svg.append("g").attr("class", "trend-axis");
  const yAxis = svg.append("g").attr("class", "trend-axis trend-y-axis");
  const details = document.querySelector("#month-trend-detail");
  const data = months.map((month) => ({ month, cells: rows.map((row) => row[month - 1]) }));
  const series = svg.append("g").selectAll("g").data(data).join("g")
    .attr("class", "trend-series")
    .attr("data-month", ({ month }) => month)
    .style("--month-color", ({ month }) => monthColors(month));
  const lines = series.append("path").attr("class", "trend-line");
  const hitLines = series.append("path").attr("class", "trend-line-hit");
  const points = series.selectAll("g").data(({ cells }) => cells.filter((cell) => cell.area !== undefined))
    .join("g").attr("class", "trend-point").attr("role", "button")
    .attr("aria-label", describe).attr("tabindex", -1)
    .classed("record-low", ({ month, year }) => month === 9 && year === 2012)
    .on("pointerenter", (_, cell) => { details.textContent = describe(cell); })
    .on("pointerleave", () => refreshFocus())
    .on("focus", function(_, cell) {
      points.attr("tabindex", -1);
      this.setAttribute("tabindex", 0);
      focused = this.matches(":focus-visible") ? cell.month : null;
      refreshFocus();
      details.textContent = describe(cell);
    })
    .on("blur", () => {
      focused = null;
      refreshFocus();
    })
    .on("click", (_, cell) => onSelect(cell.year, cell.month))
    .on("keydown", function(event, cell) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(cell.year, cell.month);
        return;
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const acrossYears = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const peers = points.filter((point) => acrossYears ? point.month === cell.month : point.year === cell.year).nodes();
      peers[peers.indexOf(this) + step]?.focus();
    });
  points.node()?.setAttribute("tabindex", 0);
  points.append("circle").attr("r", 6).attr("class", "trend-hit");
  points.append("circle").attr("r", 2).attr("class", "trend-dot");
  points.append("title").text(describe);

  let hovered;
  let focused;
  let selectedMonth = +document.querySelector("#calendar-date").value.slice(5, 7) || 9;

  const legendGroup = d3.select("#month-legend");
  const legend = legendGroup.selectAll(".month-key").data(months).join("button")
    .attr("class", "month-key").attr("type", "button")
    .attr("data-month", (month) => month).attr("aria-label", nameOfMonth)
    .style("--month-color", (month) => monthColors(month))
    .on("click", (_, month) => {
      selectedMonth = month;
      describeChange(data.find((series) => series.month === month).cells, month);
      refreshFocus();
    })
    .on("focus", function(_, month) {
      focused = this.matches(":focus-visible") ? month : null;
      refreshFocus();
    })
    .on("blur", () => { focused = null; refreshFocus(); });
  legend.append("span").attr("class", "month-swatch").attr("aria-hidden", "true");
  legend.append("span").text((month) => shortMonth(monthDate(2002, month)));
  legendGroup.on("pointerover", (event) => {
    const key = event.target.closest(".month-key");
    if (key) preview(+key.dataset.month);
  }).on("pointerleave", () => preview(null));
  series.on("pointerenter", (_, { month }) => preview(month))
    .on("pointerleave", () => preview(null));

  function preview(month) {
    if (hovered === month) return;
    hovered = month;
    refreshFocus();
  }

  function refreshFocus() {
    const active = hovered ?? focused ?? selectedMonth;
    series.classed("is-muted", ({ month }) => active != null && month !== active)
      .classed("is-active", ({ month }) => month === active);
    legend.classed("is-muted", (month) => active != null && month !== active);
    legend.attr("aria-pressed", (month) => String(month === selectedMonth));
    details.textContent = `${nameOfMonth(active)} · 2002–2025`;
  }
  refreshFocus();
  window.addEventListener("arctic-date-change", ({ detail }) => {
    selectedMonth = +detail.slice(5, 7);
    describeChange(data.find((series) => series.month === selectedMonth).cells, selectedMonth);
    refreshFocus();
  });

  new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (!width) return;
    const height = 280;
    const left = 44;
    const right = width - 17;
    const bottom = height - 31;
    const x = d3.scaleLinear(d3.extent(years), [left, right]);
    const max = d3.max(rows.flat(), (cell) => cell.area) || 1;
    const y = d3.scaleLinear([0, max * 1.08], [bottom, 12]).nice(4);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const ticks = width < 410 ? [2002, 2008, 2014, 2020, 2025] : [2002, 2006, 2010, 2014, 2018, 2022, 2025];
    xAxis.attr("transform", `translate(0,${bottom})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.format("d")).tickSizeOuter(0));
    yAxis.attr("transform", `translate(${left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(left - right).tickFormat(y.tickFormat(4, "~f")));
    const line = d3.line().defined((cell) => cell.area !== undefined)
      .x(({ year }) => x(year)).y(({ area }) => y(area));
    lines.attr("d", ({ cells }) => line(cells));
    hitLines.attr("d", ({ cells }) => line(cells));
    points.attr("transform", ({ year, area }) => `translate(${x(year)},${y(area)})`);
  }).observe(svg.node());
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
  let hoverCell;
  let selectedPeriod = document.querySelector("#calendar-date").value.slice(0, 7);
  const periodOf = (cell) => `${cell.year}-${String(cell.month).padStart(2, "0")}`;

  table.select("thead").append("tr").selectAll("th")
    .data(["Year", ...months.map((month) => shortMonth(monthDate(2002, month)))])
    .join("th").attr("scope", "col").text((label) => label);
  const tr = table.select("tbody").selectAll("tr").data(rows).join("tr");
  tr.append("th").attr("scope", "row").text((row) => row[0].year);
  const buttons = tr.selectAll("td").data((row) => row).join("td").append("button")
    .attr("type", "button").attr("tabindex", (cell) => cell === cells[0] ? 0 : -1)
    .classed("missing", (cell) => cell.area === undefined)
    .on("pointerenter", (_, cell) => showCell(cell))
    .on("pointerleave blur", () => showCell(null))
    .on("focus", function(_, cell) {
      buttons.attr("tabindex", -1);
      this.setAttribute("tabindex", 0);
      showCell(cell);
    })
    .on("click", (_, cell) => {
      selectedPeriod = periodOf(cell);
      updateSelection();
      onSelect(cell.year, cell.month);
    })
    .on("keydown", function(event, cell) {
      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -months.length, ArrowDown: months.length }[event.key];
      if (!offset) return;
      event.preventDefault();
      if ((offset === -1 && cell.month === months[0]) || (offset === 1 && cell.month === months.at(-1))) return;
      buttons.nodes()[cells.indexOf(cell) + offset]?.focus();
    });

  function updateSelection() {
    buttons.classed("is-selected", (cell) => periodOf(cell) === selectedPeriod)
      .attr("aria-pressed", (cell) => String(periodOf(cell) === selectedPeriod));
  }
  updateSelection();
  window.addEventListener("arctic-date-change", ({ detail: date }) => {
    selectedPeriod = date.slice(0, 7);
    updateSelection();
    showCell(null);
  });

  function label(cell) {
    const text = describe(cell);
    return mode.value === "anomaly" && cell.anomaly !== undefined
      ? `${text} · ${signed(cell.anomaly)} million km² from the monthly baseline` : text;
  }

  function showCell(cell) {
    hoverCell = cell;
    const selected = cells.find((cell) => periodOf(cell) === selectedPeriod);
    detail.textContent = cell ? label(cell) : selected ? `Selected: ${label(selected)}` : "Select a cell to open its daily map.";
    tr.classed("is-hovered", (row) => Boolean(cell && row[0].year === cell.year));
    table.selectAll("thead th").classed("is-hovered", (_, index) => Boolean(cell && index === cell.month));
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
    showCell(hoverCell);
  }

  mode.addEventListener("change", renderMode);
  renderMode();
}
