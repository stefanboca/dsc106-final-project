import { bounds, readRaster, southRadius } from "./gibs.js";

const d3 = window.d3;
const meanFormat = d3.format(".1f");
const areaFormat = d3.format(".2f");
const kmFormat = d3.format(",.0f");

export function createMapSummary({ size, maskFor, filterPalette }) {
  const output = document.querySelector("#map-summary");
  let region;
  let day;
  let frame;
  let revision = 0;

  function redraw() {
    revision++;
    if (frame != null) return;
    frame = requestAnimationFrame(async () => {
      frame = null;
      if (!day) return;
      const current = revision;
      const scope = region ? "Selected region" : "Full map";
      let area;
      let mean;
      if (!region && day.cutoff === null) {
        [area, mean] = day.archiveRow ?? [];
      } else {
        const selection = region;
        try {
          day.prepared ??= prepare(day.rasters, day.cutoff);
          const pixels = await day.prepared;
          if (current !== revision) return;
          if (pixels) ({ area, mean } = summarize(pixels, selection, size));
        } catch {
          if (current !== revision) return;
          output.textContent = `${scope} · Summary unavailable`;
          return;
        }
      }

      const detection = !Number.isFinite(area) ? "No ice-area summary"
        : area < 0.01 ? `${kmFormat(area * 1e6)} km² detected`
          : `${areaFormat(area)} million km² detected`;
      const temperature = Number.isFinite(mean) ? `${meanFormat(mean)} °C mean` : "No temperature summary";
      output.textContent = `${scope} · ${detection} · ${temperature}`;
    });
  }

  async function prepare(dayRasters, cutoff) {
    const [mask, palette, thermal] = await Promise.all([
      maskFor(dayRasters, cutoff),
      filterPalette,
      cutoff === null && dayRasters.temperature.hasData ? readRaster(dayRasters.temperature.blob) : null,
    ]);
    if (!mask) return null;
    const temperatures = thermal?.width === mask.width && thermal.height === mask.height
      ? thermal.data : mask.thermal;
    return { mask, palette, temperatures };
  }

  return {
    setRegion(selection) {
      region = selection;
      redraw();
    },
    setDay(rasters, cutoff, archiveRow) {
      day = { rasters, cutoff, archiveRow };
      redraw();
    },
  };
}

function summarize({ mask, palette, temperatures }, region, size) {
  const { width, height, cells } = mask;
  const [[x0, y0], [x1, y1]] = region ?? [[0, 0], [size, size]];
  const edge = (value, length) => Math.max(0, Math.min(length, Math.ceil(value / size * length - 0.5)));
  const left = edge(x0, width);
  const right = edge(x1, width);
  const top = edge(y0, height);
  const bottom = edge(y1, height);
  const pixelWidth = 2 * bounds / width;
  const pixelHeight = 2 * bounds / height;
  const weights = inverseAreaScales();
  let weightedPixels = 0;
  let sum = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    const dy = (y + 0.5 - height / 2) * pixelHeight;
    for (let x = left; x < right; x++) {
      const pixel = y * width + x;
      if (!cells[pixel]) continue;
      const dx = (x + 0.5 - width / 2) * pixelWidth;
      weightedPixels += weights[Math.round(Math.hypot(dx, dy) / 1000)];
      const offset = pixel * 4;
      if (palette && temperatures?.[offset + 3]) {
        const code = (temperatures[offset] << 16) | (temperatures[offset + 1] << 8) | temperatures[offset + 2];
        const value = palette.get(code);
        if (value !== undefined) {
          sum += value;
          count++;
        }
      }
    }
  }
  return { area: weightedPixels * pixelWidth * pixelHeight / 1e12, mean: count ? sum / count : undefined };
}

let scales;
function inverseAreaScales() {
  if (scales) return scales;
  // EPSG:3413 is conformal. Square the inverse linear scale to recover
  // ground area from projected pixel area. Cache values at 1 km radii.
  const a = 6378137;
  const e = 0.08181919084262149;
  const standardLatitude = 70 * Math.PI / 180;
  const correction = (latitude) => {
    const eSin = e * Math.sin(latitude);
    return ((1 - eSin) / (1 + eSin)) ** (e / 2);
  };
  const radiusFactor = (latitude) => Math.cos(latitude) /
    Math.sqrt(1 - (e * Math.sin(latitude)) ** 2);
  const tPerMeter = Math.tan(Math.PI / 4 - standardLatitude / 2) /
    (correction(standardLatitude) * a * radiusFactor(standardLatitude));

  scales = new Float64Array(Math.ceil(southRadius / 1000) + 1);
  scales[0] = (2 * a * tPerMeter * correction(Math.PI / 2) / Math.sqrt(1 - e ** 2)) ** 2;
  for (let index = 1; index < scales.length; index++) {
    const radius = index * 1000;
    const t = radius * tPerMeter;
    let latitude = Math.PI / 2 - 2 * Math.atan(t);
    for (let iteration = 0; iteration < 4; iteration++) {
      latitude = Math.PI / 2 - 2 * Math.atan(t * correction(latitude));
    }
    scales[index] = (a * radiusFactor(latitude) / radius) ** 2;
  }
  return scales;
}
