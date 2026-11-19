import { bounds, readRaster, southRadius } from "./gibs.js";

const selectedColor = 0xff6464;
const comparisonColor = 0x6fd7ff;
const sharedColor = 0xd8a7f5;

function rgbAt(data, offset) {
  return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

export async function iceMask(day, cutoff, palette) {
  const filtered = cutoff !== null;
  if (!day.extent.hasData || (filtered && !day.temperature.hasData)) return null;
  const [ice, temperature] = await Promise.all([
    readRaster(day.extent.blob),
    filtered ? readRaster(day.temperature.blob) : null,
  ]);
  const { width, height } = ice;
  if (temperature && (temperature.width !== width || temperature.height !== height)) {
    throw new Error("Ice and temperature raster grids do not match");
  }
  const cells = new Uint8Array(width * height);
  const radiusSquared = (southRadius / bounds * width / 2) ** 2;
  const thermal = temperature?.data;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - height / 2;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if (!ice.data[offset + 3]) continue;
      const dx = x + 0.5 - width / 2;
      if (dx * dx + dy * dy > radiusSquared) continue;
      if (thermal) {
        const value = palette.get(rgbAt(thermal, offset));
        if (!thermal[offset + 3] || value === undefined || value >= cutoff) continue;
      }
      cells[pixel] = 1;
      count++;
    }
  }
  return { width, height, cells, count, thermal };
}

function encodeRaster({ width, height }, colorAt) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const color = colorAt(pixel);
    if (color === null) continue;
    const offset = pixel * 4;
    pixels.data[offset] = color >> 16;
    pixels.data[offset + 1] = (color >> 8) & 255;
    pixels.data[offset + 2] = color & 255;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode map")));
  });
}

export async function filteredLayers(mask) {
  if (!mask?.count) return { extent: null, temperature: null };
  const [extent, temperature] = await Promise.all([
    encodeRaster(mask, (pixel) => mask.cells[pixel] ? selectedColor : null),
    encodeRaster(mask, (pixel) => mask.cells[pixel] ? rgbAt(mask.thermal, pixel * 4) : null),
  ]);
  return { extent, temperature };
}

export function comparisonLayer(selected, reference) {
  if (!selected?.count && !reference?.count) return null;
  if (selected && reference &&
      (selected.width !== reference.width || selected.height !== reference.height)) {
    throw new Error("Comparison raster grids do not match");
  }
  return encodeRaster(selected ?? reference, (pixel) => {
    const current = selected?.cells[pixel];
    const previous = reference?.cells[pixel];
    if (current && previous) return sharedColor;
    if (current) return selectedColor;
    return previous ? comparisonColor : null;
  });
}
