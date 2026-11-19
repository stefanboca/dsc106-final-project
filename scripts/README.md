# Rebuild the Arctic data

Run these commands from the repository root with [uv](https://docs.astral.sh/uv/).

```sh
uv run scripts/download_timeline.py --refresh-catalog
uv run scripts/download_maps.py 2003-09-15 2024-09-14 2024-09-15 2024-09-16
```

The timeline script reads the available dates for both Terra MODIS layers from NASA GIBS and writes `docs/data/daily-timeline.json`. It caches successful summaries per date in `.cache/timeline/`. If a request fails, rerun the script to resume. The first full download takes several minutes.

The daily data uses 360 × 360 browse images on a shared EPSG:3413 grid, with 20 km projected pixels. For ice extent, the script corrects pixel area for projection scale and sums detections north of 60° N. It estimates the observed temperature distribution from the midpoints of NASA’s color bins, using pixels with both an ice detection and a temperature retrieval. Blank dates represent missing imagery or a lack of visible detections. Dates without overlapping observations can still have an ice-extent estimate.

The map script saves the original 720 × 720 PNG for each requested date and available layer in `docs/data/maps/` and updates its index. The viewer uses this folder when a PNG is available and requests other dates from GIBS. The daily timeline and long-term charts use the bundled JSON.
