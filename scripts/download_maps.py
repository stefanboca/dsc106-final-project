# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["numpy", "pillow", "pyproj", "requests"]
# ///
"""Download 720 px NASA GIBS PNGs for dates to bundle with the map viewer."""

import argparse
import json
import os
from datetime import date

from download_timeline import CACHE, ICE, ROOT, TEMPERATURE, download_raster, get_dates

OUTPUT = ROOT / "docs" / "data" / "maps"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dates", nargs="+", type=date.fromisoformat, metavar="YYYY-MM-DD")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ice_days, temp_days = get_dates()
    days = sorted(set(args.dates))
    for key, layer, available in (
        ("extent", ICE, ice_days), ("temperature", TEMPERATURE, temp_days)
    ):
        for day in days:
            if day not in available:
                print(f"No {key} imagery for {day}")
                continue
            path = OUTPUT / f"{day}-{key}.png"
            if not path.exists():
                temporary = path.with_suffix(f".{os.getpid()}.tmp")
                temporary.write_bytes(download_raster(layer, day, 720))
                temporary.replace(path)
            print(path.relative_to(ROOT))
    paths = sorted(path.stem for path in OUTPUT.glob("*.png"))
    (OUTPUT / "index.json").write_text(json.dumps(paths, indent=2) + "\n")


if __name__ == "__main__":
    main()
