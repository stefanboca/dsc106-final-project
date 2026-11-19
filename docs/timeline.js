// Timeline gestures and viewport adapted from DSC 106 Project 3.
const d3 = window.d3;
const DAY = 86400000;
const HEIGHT = 168;
const TOP = 12;
const BASE = 139;
const DETAIL_DAYS = 32;

export function createTimeline({ onDate, rows }) {
  const calendar = document.querySelector("#calendar-date");
  const previous = document.querySelector("#previous-date");
  const next = document.querySelector("#next-date");
  const viewport = document.querySelector("#timeline-viewport");
  const summary = document.querySelector("#selected-summary");
  const status = document.querySelector("#timeline-status");
  const svg = d3.select("#temperature-timeline");
  const firstDay = new Date(calendar.min + "T00:00:00Z");
  const lastDay = new Date(calendar.max + "T00:00:00Z");
  const daySpan = d3.utcDay.count(firstDay, lastDay);
  const formatDate = d3.utcFormat("%Y-%m-%d");
  let selectedIndex = d3.utcDay.count(
    firstDay,
    new Date(calendar.value + "T00:00:00Z"),
  );
  const dateAt = (index) => new Date(+firstDay + index * DAY);
  const selectedDate = () => formatDate(dateAt(selectedIndex));
  const daily = rows.map((row, index) => {
    if (!row) return null;
    const [extent, mean, , p10, , , , p90] = row;
    const temperature = mean === undefined ? null : { mean, p10, p90 };
    return { index, date: dateAt(index), extent, temperature };
  });

  let timelineWidth = 0;
  let pixelsPerDay = 14;
  let viewStart = selectedIndex;
  const timelineMargin = { left: 42, right: 12 };
  const plotWidth = () =>
    Math.max(1, timelineWidth - timelineMargin.left - timelineMargin.right);
  const visibleSpan = () => plotWidth() / pixelsPerDay;
  const timeScale = d3.scaleUtc();

  function clampView() {
    pixelsPerDay = Math.max(
      plotWidth() / (daySpan + 1),
      Math.min(80, pixelsPerDay),
    );
    viewStart = Math.max(
      -0.5,
      Math.min(daySpan + 0.5 - visibleSpan(), viewStart),
    );
    timeScale
      .domain([dateAt(viewStart), dateAt(viewStart + visibleSpan())])
      .range([timelineMargin.left, timelineWidth - timelineMargin.right]);
  }

  const clipId = "timeline-plot-clip";
  const clip = svg.append("defs").append("clipPath").attr("id", clipId).append("rect");
  const grid = svg.append("g");
  const marks = svg.append("g").attr("clip-path", `url(#${clipId})`);
  const axis = svg.append("g");
  const playhead = svg.append("g").attr("pointer-events", "none");
  playhead.append("line").attr("y1", 7).attr("y2", BASE)
    .attr("stroke", "var(--accent)").attr("stroke-width", 1.5);
  playhead.append("path").attr("d", d3.symbol(d3.symbolTriangle).size(30)())
    .attr("transform", "translate(0,6) rotate(180)").attr("fill", "var(--accent)");

  let frame = null;
  let renderedView;
  function drawTimeline() {
    if (!timelineWidth) return;
    clampView();
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const view = `${timelineWidth}/${viewStart}/${pixelsPerDay}`;
      if (view !== renderedView) {
        renderTimeline();
        renderedView = view;
      }
      playhead.attr("transform", `translate(${timeScale(dateAt(selectedIndex))},0)`)
        .attr("display", selectedIndex < viewStart || selectedIndex > viewStart + visibleSpan() ? "none" : null);
    });
  }

  function renderGrid(ticks) {
    const rows = grid.selectAll("g").data(ticks).join("g")
      .attr("transform", ({ y }) => `translate(0,${y})`);
    rows.selectAll("line").data((tick) => [tick]).join("line")
      .attr("x1", timelineMargin.left).attr("x2", timelineWidth - timelineMargin.right)
      .attr("stroke", "#dce7e8");
    rows.selectAll("text").data((tick) => [tick]).join("text")
      .attr("x", timelineMargin.left - 5).attr("y", 3).attr("text-anchor", "end")
      .text(({ label }) => label);
  }

  const temperatureTicks = (scale) => scale.ticks(4).map((value) => ({
    y: scale(value), label: `${d3.format("~g")(value)}°`,
  }));

  function temperatureScale([low = -1, high = 1], range) {
    const padding = low === high ? 0.5 : 0;
    return d3.scaleLinear([low - padding, high + padding], range).nice(4);
  }

  function renderBand(columns, markedDays, x, y) {
    const segments = columns.flatMap((day, index) =>
      index && day.index > columns[index - 1].index + 1 ? [{}, day] : [day]);
    const area = d3.area().defined((d) => !!d.temperature).x(x)
      .y0(({ temperature }) => y(temperature.p10))
      .y1(({ temperature }) => y(temperature.p90));
    const line = d3.line().defined((d) => !!d.temperature).x(x)
      .y(({ temperature }) => y(temperature.mean));
    marks.selectAll(".temperature-band").data([segments]).join("path")
      .attr("class", "temperature-band").attr("fill", "#bdd9dd").attr("d", area);
    marks.selectAll(".temperature-mean").data([segments]).join("path")
      .attr("class", "temperature-mean").attr("fill", "none")
      .attr("stroke", "#245668").attr("stroke-width", 1.6).attr("d", line);
    const isolated = columns.filter((day, index) => day.temperature &&
      !(columns[index - 1]?.temperature && columns[index - 1].index === day.index - 1) &&
      !(columns[index + 1]?.temperature && columns[index + 1].index === day.index + 1));
    marks.selectAll(".temperature-spread").data(isolated, (d) => d.index).join("line")
      .attr("class", "temperature-spread").attr("stroke", "#7eaeb9")
      .attr("x1", x).attr("x2", x)
      .attr("y1", (d) => y(d.temperature.p10)).attr("y2", (d) => y(d.temperature.p90));
    marks.selectAll(".temperature-point")
      .data(markedDays.filter((d) => d.temperature), (d) => d.index).join("circle")
      .attr("class", "temperature-point").attr("fill", "#245668")
      .attr("r", Math.min(2, Math.max(0.7, pixelsPerDay / 4)))
      .attr("cx", x).attr("cy", (d) => y(d.temperature.mean))
      .selectAll("title").data((d) => [d]).join("title")
      .text(({ date, temperature: d }) => `${formatDate(date)} · ${d.mean.toFixed(1)} °C mean · 10th–90th ${d.p10.toFixed(1)} to ${d.p90.toFixed(1)} °C`);
  }

  function renderTimeline() {
    const first = Math.max(0, Math.ceil(viewStart));
    const last = Math.min(daySpan, Math.floor(viewStart + visibleSpan()));
    const columns = daily.slice(first, last + 1).filter(Boolean);
    const step = Math.max(1, Math.ceil(3 / pixelsPerDay));
    const markedDays = columns.filter((day) => day.index % step === 0);
    const band = temperatureScale([
      d3.min(columns, ({ temperature }) => temperature && Math.min(temperature.p10, temperature.mean)),
      d3.max(columns, ({ temperature }) => temperature && Math.max(temperature.p90, temperature.mean)),
    ], [BASE, TOP]);
    const x = (d) => timeScale(d.date);
    const span = visibleSpan();
    const formatTick = d3.utcFormat(span > 730 ? "%Y" : span > 120 ? "%b %Y" : "%b %d");

    svg.attr("viewBox", `0 0 ${timelineWidth} ${HEIGHT}`);
    clip.attr("x", timelineMargin.left).attr("y", TOP - 1)
      .attr("width", plotWidth()).attr("height", BASE - TOP + 2);
    renderGrid(temperatureTicks(band));
    renderBand(columns, markedDays, x, band);
    axis.attr("transform", `translate(0,${BASE + 7})`).call(
      d3.axisBottom(timeScale).ticks(Math.max(2, Math.floor(plotWidth() / 68)))
        .tickFormat(formatTick).tickSize(4),
    );

    const formatRange = d3.utcFormat("%b %-d, %Y");
    const detail = columns.some((day) => day.temperature)
      ? "Gaps indicate dates without temperature observations."
      : "No temperature observations in this range.";
    const firstLabel = formatRange(dateAt(first));
    const lastLabel = formatRange(dateAt(last));
    status.textContent = `${first >= last ? firstLabel : `${firstLabel} – ${lastLabel}`}. ${detail}`;
  }

  function selectDay(index, { reveal = true } = {}) {
    const previousIndex = selectedIndex;
    selectedIndex = Math.max(0, Math.min(daySpan, Math.round(index)));
    if (
      reveal &&
      (selectedIndex < viewStart || selectedIndex > viewStart + visibleSpan())
    ) {
      viewStart = selectedIndex - visibleSpan() / 2;
    }
    syncDate();
    if (selectedIndex !== previousIndex) onDate(selectedDate());
  }

  function syncDate() {
    calendar.value = selectedDate();
    previous.disabled = selectedIndex === 0;
    next.disabled = selectedIndex === daySpan;
    refresh();
  }

  function refresh() {
    const date = selectedDate();
    const day = daily[selectedIndex];
    const mean = day?.temperature;
    const area = day?.extent;
    const measures = [
      mean ? `${mean.mean.toFixed(1)} °C mean` : "No temperature summary",
      Number.isFinite(area) ? `${area.toFixed(2)} million km² detected` : "No extent summary",
    ];
    summary.textContent = [date, ...measures].join(" · ");
    drawTimeline();
  }

  function selectDate(date) {
    selectDay(d3.utcDay.count(firstDay, new Date(date + "T00:00:00Z")));
  }

  calendar.addEventListener("change", () => {
    if (calendar.validity.valid) selectDate(calendar.value);
    else calendar.value = selectedDate();
  });
  previous.addEventListener("click", () => selectDay(selectedIndex - 1));
  next.addEventListener("click", () => selectDay(selectedIndex + 1));

  function zoomTimeline(factor, anchorX) {
    const x = Math.max(
      timelineMargin.left,
      Math.min(timelineWidth - timelineMargin.right, anchorX),
    );
    const anchorDay = viewStart + (x - timelineMargin.left) / pixelsPerDay;
    pixelsPerDay = Math.max(
      plotWidth() / (daySpan + 1),
      Math.min(80, pixelsPerDay * factor),
    );
    viewStart = anchorDay - (x - timelineMargin.left) / pixelsPerDay;
    drawTimeline();
  }
  svg.node().addEventListener(
    "wheel",
    (event) => {
      const zooming = event.ctrlKey || event.metaKey;
      const raw = zooming
        ? Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
        : event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!raw) return;
      event.preventDefault();
      const delta =
        raw *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotWidth() : 1);
      if (zooming)
        zoomTimeline(
          Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.004),
          d3.pointer(event, event.currentTarget)[0],
        );
      else {
        viewStart += delta / pixelsPerDay;
        drawTimeline();
      }
    },
    { passive: false },
  );
  let scrubPointer = null;
  const timelineTouches = new Map();
  let touchSession = null;
  let touchGesture = null;
  let touchCommit = null;
  function scrubAtX(x) {
    const bounded = Math.max(
      timelineMargin.left,
      Math.min(timelineWidth - timelineMargin.right, x),
    );
    selectDay(
      d3.utcDay.count(firstDay, d3.utcDay.round(timeScale.invert(bounded))),
      { reveal: false },
    );
  }
  function captureTimelinePointer(event) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  }
  function beginTouchGesture() {
    clearTimeout(touchCommit);
    touchCommit = null;
    touchSession.hadMultiple = true;
    const [a, b] = [...timelineTouches.values()];
    const centerX = (a.x + b.x) / 2;
    touchGesture = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      scale: pixelsPerDay,
      anchorDay: viewStart + (centerX - timelineMargin.left) / pixelsPerDay,
    };
  }
  function moveTouchGesture() {
    const [a, b] = [...timelineTouches.values()];
    const centerX = (a.x + b.x) / 2;
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    pixelsPerDay = Math.max(
      plotWidth() / (daySpan + 1),
      Math.min(80, (touchGesture.scale * distance) / touchGesture.distance),
    );
    viewStart =
      touchGesture.anchorDay - (centerX - timelineMargin.left) / pixelsPerDay;
    drawTimeline();
  }
  function finishTimelinePointer(event) {
    if (timelineTouches.has(event.pointerId)) {
      clearTimeout(touchCommit);
      touchCommit = null;
      // A two-finger gesture never turns into a scrub as fingers lift one by one.
      if (
        event.type === "pointerup" &&
        timelineTouches.size === 1 &&
        !touchSession.hadMultiple &&
        touchSession.eligible
      ) {
        scrubAtX(d3.pointer(event, event.currentTarget)[0]);
      }
      timelineTouches.delete(event.pointerId);
      if (timelineTouches.size >= 2) beginTouchGesture();
      else touchGesture = null;
      if (!timelineTouches.size) touchSession = null;
    }
    if (event.pointerId === scrubPointer) scrubPointer = null;
  }
  svg
    .on("pointerdown", (event) => {
      if (event.button !== 0) return;
      const [x, y] = d3.pointer(event, event.currentTarget);
      if (event.pointerType === "touch") {
        event.preventDefault();
        if (!timelineTouches.size)
          touchSession = {
            start: { x, y },
            active: false,
            hadMultiple: false,
            eligible:
              x >= timelineMargin.left &&
              x <= timelineWidth - timelineMargin.right,
          };
        timelineTouches.set(event.pointerId, { x, y });
        captureTimelinePointer(event);
        viewport.focus({ preventScroll: true });
        if (timelineTouches.size >= 2) beginTouchGesture();
        return;
      }
      if (x < timelineMargin.left) return;
      event.preventDefault();
      scrubPointer = event.pointerId;
      viewport.focus({ preventScroll: true });
      captureTimelinePointer(event);
      scrubAtX(x);
    })
    .on("pointermove", (event) => {
      const [x, y] = d3.pointer(event, event.currentTarget);
      if (timelineTouches.has(event.pointerId)) {
        event.preventDefault();
        timelineTouches.set(event.pointerId, { x, y });
        if (timelineTouches.size >= 2 && touchGesture) moveTouchGesture();
        else if (!touchSession.hadMultiple && touchSession.eligible) {
          if (touchSession.active) scrubAtX(x);
          else if (
            !touchCommit &&
            Math.hypot(x - touchSession.start.x, y - touchSession.start.y) >= 4
          ) {
            // Give the second finger a short arrival window before committing a scrub.
            touchCommit = setTimeout(() => {
              touchCommit = null;
              if (timelineTouches.size === 1 && !touchSession?.hadMultiple) {
                touchSession.active = true;
                scrubAtX([...timelineTouches.values()][0].x);
              }
            }, 60);
          }
        }
      } else if (event.pointerId === scrubPointer) scrubAtX(x);
    })
    .on("pointerup pointercancel lostpointercapture", finishTimelinePointer);
  window.addEventListener("blur", () => {
    clearTimeout(touchCommit);
    touchCommit = null;
    timelineTouches.clear();
    touchSession = null;
    touchGesture = null;
    scrubPointer = null;
  });

  function stepDateWithArrow(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.isContentEditable ||
        target.closest('input, textarea, select, [role="textbox"]'))
    )
      return;
    const step = event.shiftKey ? 7 : 1;
    event.preventDefault();
    selectDay(selectedIndex + (event.key === "ArrowRight" ? step : -step));
  }
  viewport.addEventListener("keydown", stepDateWithArrow);
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectDay(event.key === "Home" ? 0 : daySpan);
    } else if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      zoomTimeline(
        event.key === "-" ? 0.8 : 1.25,
        timelineMargin.left + plotWidth() / 2,
      );
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      viewStart += visibleSpan() * (event.key === "PageDown" ? 0.8 : -0.8);
      drawTimeline();
    }
  });

  new ResizeObserver(([entry]) => {
    const span = timelineWidth ? visibleSpan() : DETAIL_DAYS;
    const center = timelineWidth ? viewStart + span / 2 : selectedIndex;
    timelineWidth = Math.floor(entry.contentRect.width);
    if (!timelineWidth) return;
    pixelsPerDay = plotWidth() / span;
    viewStart = center - span / 2;
    drawTimeline();
  }).observe(svg.node());
  syncDate();
  return { selectedDate, selectDate };
}
