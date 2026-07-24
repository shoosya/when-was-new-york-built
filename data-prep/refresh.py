"""
Refresh all the map data in one command.

Runs the whole pipeline end to end: pull + clean every borough from PLUTO,
then export the GeoJSON the site loads. This just calls the other scripts in
order, so it's the same work as running them by hand — only automated.

Run it like:
    python data-prep/refresh.py              # all five boroughs -> GeoJSON
    python data-prep/refresh.py --outlines   # also refresh borough outlines
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

BOROUGHS = ["MN", "BX", "BK", "QN", "SI"]
HERE = Path(__file__).parent


def run(script, *args):
    """Run one of the sibling scripts with the same Python we're running under."""
    cmd = [sys.executable, str(HERE / script), *args]
    print(f"\n=== {script} {' '.join(args)} ===")
    # check=True stops the whole refresh if any step fails, so we never export
    # from half-updated data.
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description="Refresh all PLUTO map data.")
    parser.add_argument(
        "--outlines",
        action="store_true",
        help="Also refresh the borough outlines (rarely changes; off by default).",
    )
    args = parser.parse_args()

    start = time.time()

    for borough in BOROUGHS:
        run("fetch_pluto.py", "--borough", borough)
    run("export_geojson.py")
    if args.outlines:
        run("fetch_boroughs.py")

    minutes = (time.time() - start) / 60
    print(f"\nAll done in {minutes:.1f} min. Refreshed GeoJSON is in docs/data/.")


if __name__ == "__main__":
    main()
