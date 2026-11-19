# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["numpy", "pillow", "pyproj", "requests"]
# ///
"""Download NASA GIBS observations and write the static daily timeline data."""

import argparse
import io
import json
import os
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from pyproj import Proj, Transformer
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "timeline"
OUTPUT = ROOT / "docs" / "data" / "daily-timeline.json"
COLORS = ROOT / "docs" / "data" / "ice-temperature-colors.xml"
ENDPOINT = "https://gibs.earthdata.nasa.gov/wms/epsg3413/best/wms.cgi"
ICE = "MODIS_Terra_L3_Sea_Ice_Daily"
TEMPERATURE = "MODIS_Terra_L3_Ice_Surface_Temp_Daily_Day"
LIMIT = 3_600_000
SIZE = 360
DAY = timedelta(days=1)
GIBS = {"SERVICE": "WMS", "VERSION": "1.3.0"}
LOCAL = threading.local()


def session():
    if not hasattr(LOCAL, "session"):
        LOCAL.session = requests.Session()
        LOCAL.session.mount("https://", HTTPAdapter(max_retries=Retry(
            total=4, backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
        )))
    return LOCAL.session


def download(params):
    response = session().get(ENDPOINT, params=GIBS | params, timeout=(10, 35))
    response.raise_for_status()
    return response.content


def get_dates(*, refresh=False):
    metadata = CACHE / "capabilities.xml"
    new_catalog = refresh or not metadata.exists()
    content = download({"REQUEST": "GetCapabilities"}) if new_catalog else metadata.read_bytes()
    xml = ET.fromstring(content)
    dates = {}
    for layer in xml.findall(".//{*}Layer"):
        name = layer.findtext("{*}Name")
        if name not in (ICE, TEMPERATURE):
            continue
        time = next(d for d in layer.findall("{*}Dimension") if d.get("name") == "time")
        days = set()
        for period in time.text.strip().split(","):
            first, *end = period.split("/")
            start = date.fromisoformat(first)
            last = date.fromisoformat(end[0]) if end else start
            if end and end[1] != "P1D":
                raise ValueError(f"Unexpected GIBS time interval {period}")
            days.update(start + offset * DAY for offset in range((last - start).days + 1))
        dates[name] = days
    ice_days, temperature_days = dates[ICE], dates[TEMPERATURE]
    if new_catalog:
        temporary = metadata.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_bytes(content)
        temporary.replace(metadata)
    return ice_days, temperature_days


def grid_weights():
    width = 2 * LIMIT / SIZE
    axis = np.linspace(-LIMIT + width / 2, LIMIT - width / 2, SIZE)
    x, y = np.meshgrid(axis, axis[::-1])
    lon, lat = Transformer.from_crs(3413, 4326, always_xy=True).transform(x, y)
    scale = Proj("EPSG:3413").get_factors(lon, lat).areal_scale
    return np.where(lat >= 60, width**2 / scale / 1e12, 0)


def palette():
    entries = []
    for entry in ET.parse(COLORS).findall(".//ColorMapEntry"):
        if entry.get("transparent") != "false":
            continue
        r, g, b = map(int, entry.get("rgb").split(","))
        low, high = map(float, entry.get("value")[1:-1].split(","))
        entries.append(((r << 16) | (g << 8) | b, (low + high) / 2 - 273.15))
    entries.sort()
    return np.array(entries).T


def download_raster(layer, day, size):
    content = download({
        "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
        "FORMAT": "image/png", "TRANSPARENT": "TRUE", "CRS": "EPSG:3413",
        "BBOX": f"-{LIMIT},-{LIMIT},{LIMIT},{LIMIT}",
        "WIDTH": size, "HEIGHT": size, "TIME": day.isoformat(),
    })
    with Image.open(io.BytesIO(content)) as image:
        if image.format != "PNG" or image.size != (size, size):
            raise ValueError(f"Unexpected WMS image for {layer} on {day}")
    return content


def raster(layer, day):
    with Image.open(io.BytesIO(download_raster(layer, day, SIZE))) as image:
        return np.asarray(image.convert("RGBA"))


def summarize(day, has_temperature, weights, colors):
    target = CACHE / f"{day}.json"
    if target.exists():
        return json.loads(target.read_bytes())

    ice = raster(ICE, day)
    mask = (ice[:, :, 3] > 0) & (weights > 0)
    extent = float(weights[mask].sum())
    result = [round(extent, 4)] if extent else None
    if extent and has_temperature:
        samples = raster(TEMPERATURE, day)[mask]
        rgb = samples[samples[:, 3] == 255, :3].astype(np.int32)
        codes = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
        keys, values = colors
        positions = np.searchsorted(keys, codes).clip(max=len(keys) - 1)
        temperatures = values[positions[keys[positions] == codes]]
        if temperatures.size:
            quantiles = np.quantile(temperatures, [0, .1, .25, .5, .75, .9, 1])
            result.extend(round(float(t), 2) for t in [temperatures.mean(), *quantiles])

    temporary = target.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(result))
    temporary.replace(target)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", default=12, type=int, help="Concurrent date downloads")
    parser.add_argument("--refresh-catalog", action="store_true", help="Refresh the NASA date listing")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    ice_days, temperature_days = get_dates(refresh=args.refresh_catalog)
    first, last = min(ice_days | temperature_days), max(ice_days | temperature_days)
    dates = [first + offset * DAY for offset in range((last - first).days + 1)]
    rows = [None] * len(dates)
    weights, colors = grid_weights(), palette()
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {
            pool.submit(summarize, day, day in temperature_days, weights, colors): index
            for index, day in enumerate(dates) if day in ice_days
        }
        for completed, future in enumerate(as_completed(pending), 1):
            index = pending[future]
            try:
                rows[index] = future.result()
            except (OSError, ValueError, requests.RequestException) as error:
                failures.append(dates[index])
                print(f"{dates[index]}: {error}", flush=True)
            if completed % 250 == 0 or completed == len(pending):
                print(f"{completed:,}/{len(pending):,} archive days processed", flush=True)

    if failures:
        raise SystemExit(f"{len(failures)} downloads failed. Rerun to resume from the cache.")

    output = {
        "first": first.isoformat(),
        "last": last.isoformat(),
        "gridMeters": 2 * LIMIT // SIZE,
        "layers": {"extent": ICE, "temperature": TEMPERATURE},
        "unavailable": {
            "extent": [d.isoformat() for d in dates if d not in ice_days],
            "temperature": [d.isoformat() for d in dates if d not in temperature_days],
        },
        "columns": ["extent", "mean", "min", "p10", "q1", "median", "q3", "p90", "max"],
        "days": rows,
    }
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    temporary.replace(OUTPUT)
    print(f"Wrote {len(rows):,} days to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
