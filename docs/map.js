import {
  bounds, fetchMap, loadArchive, loadBundledMaps, rasterHasData, southRadius,
  temperatureColors,
} from "./gibs.js";
import { createLookback } from "./comparison.js";
import { comparisonLayer, filteredLayers, iceMask } from "./ice-masks.js";
import { linkMapInteractions } from "./map-interaction.js";
import { createMapSummary } from "./map-summary.js";
import { createTimeline } from "./timeline.js";
import { createTrends } from "./trends.js";

const d3 = window.d3;
const mapSize = 700;
const center = mapSize / 2;
const mapRadius = center * southRadius / bounds;
const mapDate = document.querySelector("#map-date");
const timelineStatus = document.querySelector("#timeline-status");
const retry = document.querySelector("#retry-map");
const bundledMaps = loadBundledMaps();
const archive = await loadArchive().catch((error) => {
  timelineStatus.textContent = "The bundled timeline data could not be loaded.";
  throw error;
});
const calendar = document.querySelector("#calendar-date");
const initialDate = calendar.value;
calendar.min = archive.first;
calendar.max = archive.last;
calendar.value = initialDate;

function stereographicFactor(radius) {
  const eccentricity = 0.08181919084262149; // WGS 84.
  const sineLatitude = (1 - radius ** 2) / (1 + radius ** 2);
  const term = eccentricity * sineLatitude;
  return ((1 + term) / (1 - term)) ** (eccentricity / 2);
}

function ellipsoidalRaw(lambda, phi) {
  const [x, y] = d3.geoStereographicRaw(lambda, phi);
  const factor = stereographicFactor(Math.hypot(x, y));
  return [x * factor, y * factor];
}

const radiusAt60 = Math.tan(Math.PI / 12);
const projection = d3.geoProjection(ellipsoidalRaw)
  .rotate([45, -90])
  .translate([center, center])
  .scale(mapRadius / (radiusAt60 * stereographicFactor(radiusAt60)))
  .clipAngle(44);
const path = d3.geoPath(projection);
const places = [
  { name: "Alaska", coordinates: [-147, 66] },
  { name: "Canada", coordinates: [-105, 66.5] },
  { name: "Greenland", coordinates: [-41, 72] },
  { name: "Svalbard", coordinates: [21, 77] },
  { name: "Russia", coordinates: [111, 67] },
];
const graticule = d3.geoGraticule().extent([[-180, 60], [180, 90]]).step([45, 10]);

function drawMap(key) {
  const panel = d3.select(`#${key}`);
  const svg = panel.select(".polar-map");
  const status = panel.select(".layer-status");
  const clipId = `${key}-polar-clip`;
  svg.append("defs").append("clipPath").attr("id", clipId)
    .append("circle").attr("cx", center).attr("cy", center).attr("r", mapRadius);
  const scene = svg.append("g").attr("clip-path", `url(#${clipId})`).attr("aria-hidden", "true");
  scene.append("circle").attr("class", "ocean").attr("cx", center).attr("cy", center).attr("r", mapRadius);
  const land = scene.append("path").attr("class", "land");
  scene.append("path").attr("class", "graticule").attr("d", path(graticule()));
  scene.append("path").attr("class", "pole")
    .attr("d", `M${center - 5},${center}h10 M${center},${center - 5}v10`);
  scene.selectAll(".place").data(places).join("text").attr("class", "place")
    .attr("transform", (d) => `translate(${projection(d.coordinates)})`).text((d) => d.name);
  svg.append("circle").attr("class", "outline").attr("cx", center).attr("cy", center).attr("r", mapRadius);
  return { svg, scene, status, land, image: null, url: null };
}

const maps = Object.fromEntries(Object.keys(archive.layers).map((key) => [key, drawMap(key)]));
d3.json("./data/land.geojson").then((land) => {
  for (const map of Object.values(maps)) map.land.datum(land).attr("d", path);
}).catch(() => {
  document.querySelector(".source-note").append(" Coastlines are currently unavailable.");
});

function drawLegend(colors) {
  const first = colors[0].low;
  const last = colors.at(-1).high;
  const width = 265;
  const position = d3.scaleLinear().domain([first, last]).range([9, width - 12]);
  const svg = d3.select(".temperature-legend").append("svg")
    .attr("viewBox", `0 0 ${width} 32`).attr("aria-hidden", "true");
  svg.selectAll("rect").data(colors).join("rect")
    .attr("x", (d) => position(d.low)).attr("y", 1)
    .attr("width", (d) => position(d.high) - position(d.low) + 0.15)
    .attr("height", 8).attr("fill", (d) => `rgb(${d.rgb.join(",")})`);
  const ticks = [-50, -30, -10, 10, 30];
  svg.append("g").attr("transform", "translate(0,10)")
    .attr("color", "#4d656f")
    .call(d3.axisBottom(position).tickValues(ticks).tickSize(3)
      .tickFormat((value) => `${d3.format("d")(value)}°`))
    .call((axis) => axis.select(".domain").remove());
  svg.append("text").attr("x", width).attr("y", 23).attr("text-anchor", "end")
    .attr("fill", "#4d656f").attr("font-size", 10).text("°C");
}

const filterEnabled = document.querySelector("#filter-enabled");
const cutoffInput = document.querySelector("#temperature-cutoff");
const cutoffValue = document.querySelector("#cutoff-value");
const temperatureLabel = (value) => `${d3.format("d")(value)} °C`;
const filterPalette = temperatureColors().then((colors) => {
  if (!colors.length) throw new Error("NASA temperature palette is empty");
  drawLegend(colors);
  filterEnabled.disabled = false;
  return new Map(colors.map(({ rgb: [r, g, b], low, high }) => [
    (r << 16) | (g << 8) | b, (low + high) / 2,
  ]));
}).catch(() => {
  document.querySelector(".temperature-legend").textContent = "NASA temperature legend unavailable";
  filterEnabled.title = "Temperature filtering requires the NASA color scale.";
  return null;
});

const maskCache = new WeakMap();
async function maskFor(day, cutoff) {
  const cached = maskCache.get(day);
  if (cached?.cutoff === cutoff) return cached.mask;
  const mask = cutoff === null
    ? iceMask(day, cutoff, null)
    : filterPalette.then((palette) => {
      if (!palette) throw new Error("Temperature color scale unavailable");
      return iceMask(day, cutoff, palette);
    });
  maskCache.set(day, { cutoff, mask });
  return mask;
}

const mapSummary = createMapSummary({ size: mapSize, maskFor, filterPalette });
linkMapInteractions(Object.values(maps), mapSize, mapRadius, mapSummary.setRegion);

const prettyDate = d3.utcFormat("%B %-d, %Y");
const dateString = d3.utcFormat("%Y-%m-%d");
const asDate = (date) => new Date(date + "T00:00:00Z");
const minimumDay = asDate(archive.first);
const maximumDay = asDate(archive.last);
const timeline = createTimeline({ onDate: selectDate, rows: archive.days });
const lookback = createLookback({ firstDate: archive.first, onChange: redrawMaps });
createTrends({
  archive,
  onSelect(year, month) {
    const current = asDate(timeline.selectedDate());
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = current.getUTCMonth() === month - 1 ? Math.min(current.getUTCDate(), lastDay) : 15;
    timeline.selectDate(dateString(new Date(Date.UTC(year, month - 1, day))));
  },
});
const mapStatus = document.querySelector("#map-status");
const dayCache = new Map();
const prefetchRadius = 7;
const overlayPrefetchRadius = 3;
// Both displayed dates, both day windows, and two adjacent slider positions.
const mapCacheLimit = 2 * (prefetchRadius + overlayPrefetchRadius) + 4;
let displayedDate;
let mapRequest;
let selectionTimer;
let loadingTimer;
let redrawTimer;
let warmKey;
let warmGeneration = 0;
let warmingGeneration;

function readMapDay(date) {
  let entry = dayCache.get(date);
  if (entry) {
    dayCache.delete(date);
    dayCache.set(date, entry);
    return entry.promise;
  }
  const controller = new AbortController();
  entry = { controller, ready: false };
  entry.promise = bundledMaps.then((local) => Promise.all(Object.keys(maps).map(async (key) => {
    const blob = await fetchMap(archive, local, key, date, controller.signal);
    return [key, { blob, hasData: await rasterHasData(blob) }];
  }))).then((rasters) => {
    entry.ready = true;
    return Object.fromEntries(rasters);
  }).catch((error) => {
    controller.abort();
    if (dayCache.get(date) === entry) dayCache.delete(date);
    throw error;
  });
  dayCache.set(date, entry);
  while (dayCache.size > mapCacheLimit) {
    const [oldDate, oldEntry] = dayCache.entries().next().value;
    oldEntry.controller.abort();
    dayCache.delete(oldDate);
  }
  return entry.promise;
}

function prefetchDates(date) {
  const center = asDate(date);
  const days = [];
  for (let distance = 1; distance <= prefetchRadius; distance++) {
    for (const offset of [distance, -distance]) {
      const day = d3.utcDay.offset(center, offset);
      if (day < minimumDay || day > maximumDay) continue;
      const neighbor = dateString(day);
      days.push(neighbor);
      if (distance <= overlayPrefetchRadius) days.push(lookback.referenceFor(neighbor));
    }
    if (distance === 1) {
      days.push(lookback.referenceFor(date, -1), lookback.referenceFor(date, 1));
    }
  }
  return days;
}

function warmMapNeighbors(date, neighbors, generation) {
  // Keep nearby pending entries so a scrub can use a request already in flight.
  (async () => {
    for (const day of neighbors) {
      if (generation !== warmGeneration || date !== timeline.selectedDate()) return;
      try {
        await readMapDay(day);
      } catch {
        // A failed prefetch stays eligible for a foreground retry.
      }
    }
  })();
}

async function prepareOverlay(rasters, earlier, reference, cutoff, signal) {
  const label = prettyDate(asDate(reference));
  try {
    const day = await earlier;
    if (signal.aborted) return {};
    if (!day) throw new Error("Earlier imagery unavailable");
    const [selected, previous] = await Promise.all([maskFor(rasters, cutoff), maskFor(day, cutoff)]);
    if (signal.aborted) return {};
    if (!previous) return { notice: `No usable ice detections for ${label}.` };
    const image = await comparisonLayer(selected, previous);
    const detail = !selected ? " No usable ice detections for the selected day."
      : !image ? " No detections meet the current cutoff." : "";
    return { reference, image, notice: `Same-day overlay with ${label}.${detail}` };
  } catch {
    return { notice: `Could not load the overlay for ${label}.`, failed: true };
  }
}

function selectDate(date) {
  mapRequest?.abort();
  clearTimeout(selectionTimer);
  clearTimeout(loadingTimer);
  clearTimeout(redrawTimer);
  retry.hidden = true;
  const cutoff = filterEnabled.checked ? cutoffInput.valueAsNumber : null;
  const { reference, notice } = lookback.forDate(date);
  const wanted = new Set([date, reference, ...prefetchDates(date)].filter(Boolean));
  const neighbors = [...wanted].filter((day) => day !== date && day !== reference);
  const key = JSON.stringify([date, reference, neighbors]);
  if (key !== warmKey) {
    warmKey = key;
    warmGeneration++;
  }
  const generation = warmGeneration;
  for (const [cachedDate, entry] of dayCache) {
    if (!entry.ready && !wanted.has(cachedDate)) {
      entry.controller.abort();
      dayCache.delete(cachedDate);
    }
  }

  const controller = new AbortController();
  mapRequest = controller;
  const day = asDate(date);
  const label = prettyDate(day);
  if (displayedDate) {
    mapStatus.textContent = "";
    loadingTimer = setTimeout(() => {
      mapStatus.textContent = `Loading ${label}…`;
    }, 140);
  } else {
    mapStatus.textContent = `Loading ${label}…`;
  }
  for (const map of Object.values(maps)) map.svg.attr("aria-busy", "true");

  async function show() {
    const { signal } = controller;
    let staged = [];
    try {
      const current = readMapDay(date);
      const earlier = reference ? readMapDay(reference).catch(() => null) : null;
      const rasters = await current;
      if (signal.aborted) return;
      const mask = cutoff === null ? null : await maskFor(rasters, cutoff);
      const images = cutoff === null
        ? Object.fromEntries(Object.entries(rasters).map(([key, { blob, hasData }]) => [key, hasData ? blob : null]))
        : await filteredLayers(mask);
      const overlay = reference ? await prepareOverlay(rasters, earlier, reference, cutoff, signal) : { notice };
      if (signal.aborted) return;
      if (overlay.reference) images.extent = overlay.image;
      staged = Object.entries(maps).map(([key, map]) => stageMap(map, images[key], signal));
      await Promise.all(staged.map((stage) => stage.ready));
      if (signal.aborted) return;

      // Commit both maps in the same frame with the previous pair still visible.
      const threshold = cutoff === null ? "" : temperatureLabel(cutoff);
      Object.entries(maps).forEach(([key, map], index) => {
        staged[index].commit();
        const { blob, hasData } = rasters[key];
        const isIce = key === "extent";
        const state = cutoff !== null
          ? mask?.count ? `Detected ice below ${threshold}.`
            : `No ice detections with a temperature retrieval below ${threshold}.`
          : !blob ? "No archive imagery for this date."
            : !hasData ? (isIce ? "No ice detections visible." : "No temperature retrievals visible.")
              : (isIce ? "Observed ice is shown in coral." : "Retrievals can extend beyond the ice detected in the extent map.");
        const message = isIce && overlay.notice ? overlay.notice : state;
        map.status.text(message);
        map.svg.attr("aria-label", `${isIce ? "Sea ice extent" : "Ice-surface temperature"}, ${label}. ${message}`);
      });
      lookback.setLegend(date, overlay.reference);
      retry.hidden = !overlay.failed;
      displayedDate = date;
      mapDate.textContent = label;
      mapStatus.textContent = "";
      mapSummary.setDay(rasters, cutoff, archive.days[d3.utcDay.count(minimumDay, day)]);
    } catch {
      if (signal.aborted) return;
      retry.hidden = false;
      mapStatus.textContent = displayedDate
        ? `Could not load ${label}. Maps still show ${prettyDate(asDate(displayedDate))}.`
        : `Could not load ${label}.`;
    } finally {
      for (const stage of staged) stage.dispose();
      if (!signal.aborted) {
        clearTimeout(loadingTimer);
        for (const map of Object.values(maps)) map.svg.attr("aria-busy", "false");
        if (warmingGeneration !== generation) {
          warmingGeneration = generation;
          warmMapNeighbors(date, neighbors, generation);
        }
      }
    }
  }

  if (dayCache.has(date) || !displayedDate) show();
  else selectionTimer = setTimeout(show, 80);
}

function stageMap(map, blob, signal) {
  const image = blob ? map.scene.insert("image", ".graticule")
    .attr("width", mapSize).attr("height", mapSize).attr("opacity", 0) : null;
  const url = blob ? URL.createObjectURL(blob) : null;
  let committed = false;
  let cancel;
  const ready = image ? new Promise((resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    image.on("load", resolve).on("error", () => reject(new Error("Unable to decode map")))
      .attr("href", url);
  }) : Promise.resolve();

  return {
    ready,
    commit() {
      image?.attr("opacity", null);
      map.image?.remove();
      if (map.url) URL.revokeObjectURL(map.url);
      map.image = image;
      map.url = url;
      committed = true;
    },
    dispose() {
      if (cancel) signal.removeEventListener("abort", cancel);
      image?.on("load", null).on("error", null);
      if (!committed) {
        image?.remove();
        if (url) URL.revokeObjectURL(url);
      }
    },
  };
}

retry.addEventListener("click", () => selectDate(timeline.selectedDate()));
function updateFilter() {
  cutoffInput.disabled = !filterEnabled.checked;
  const label = temperatureLabel(cutoffInput.valueAsNumber);
  cutoffValue.textContent = label;
  cutoffInput.setAttribute("aria-valuetext", label);
  redrawMaps();
}
function redrawMaps() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => selectDate(timeline.selectedDate()), 40);
}
filterEnabled.addEventListener("change", updateFilter);
cutoffInput.addEventListener("input", updateFilter);
selectDate(timeline.selectedDate());
