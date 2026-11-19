const endpoint = "https://gibs.earthdata.nasa.gov/wms/epsg3413/best/wms.cgi";
export const bounds = 3_600_000;
export const southRadius = 3_323_160.27; // EPSG:3413 radius at 60° N.

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

export async function loadArchive() {
  const archive = await readJson("./data/daily-timeline.json");
  return {
    ...archive,
    unavailable: Object.fromEntries(Object.entries(archive.unavailable)
      .map(([key, days]) => [key, new Set(days)])),
  };
}

export async function loadBundledMaps() {
  try {
    return new Set(await readJson("./data/maps/index.json"));
  } catch {
    return new Set();
  }
}

export async function fetchMap(archive, bundledMaps, key, date, signal) {
  if (archive.unavailable[key].has(date)) return null;
  const filename = `${date}-${key}`;
  if (bundledMaps.has(filename)) {
    const local = await fetch(`./data/maps/${filename}.png`, { signal });
    if (local.ok && local.headers.get("content-type")?.startsWith("image/png")) {
      return local.blob();
    }
  }
  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: archive.layers[key],
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    CRS: "EPSG:3413",
    BBOX: `-${bounds},-${bounds},${bounds},${bounds}`,
    WIDTH: 720,
    HEIGHT: 720,
    TIME: date,
  });
  const response = await fetch(`${endpoint}?${query}`, { signal });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) {
    throw new Error(`NASA GIBS imagery unavailable for ${date}`);
  }
  return response.blob();
}

export async function temperatureColors() {
  const response = await fetch("./data/ice-temperature-colors.xml");
  if (!response.ok) throw new Error("Temperature color scale unavailable");
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  return [...xml.querySelectorAll('ColorMapEntry[transparent="false"][value]')].map((entry) => {
    const rgb = entry.getAttribute("rgb").split(",").map(Number);
    const [low, high] = entry.getAttribute("value").slice(1, -1).split(",").map(Number);
    return { rgb, low: low - 273.15, high: high - 273.15 };
  });
}

const decodedRasters = new WeakMap();

export function readRaster(blob) {
  if (!decodedRasters.has(blob)) decodedRasters.set(blob, decodeRaster(blob));
  return decodedRasters.get(blob);
}

async function decodeRaster(blob) {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const width = canvas.width = image.width;
  const height = canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  image.close();
  return context.getImageData(0, 0, width, height);
}

export async function rasterHasData(blob) {
  if (!blob) return false;
  const { width, height, data: rgba } = await readRaster(blob);
  const maxRadius = (southRadius / bounds * width / 2) ** 2;
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - height / 2;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!rgba[index + 3]) continue;
      const dx = x + 0.5 - width / 2;
      if (dx * dx + dy * dy <= maxRadius) return true;
    }
  }
  return false;
}
