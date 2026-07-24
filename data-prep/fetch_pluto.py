"""
Stage 1 — Get and shape the data.

Pulls NYC PLUTO tax-lot records from the city's Socrata Open Data API,
one borough at a time, cleans them with pandas, and buckets each lot's
year-built into a decade. The result is saved as a CSV that Stage 2
(export_geojson.py) turns into map files.

Run it like:
    python fetch_pluto.py            # defaults to Manhattan
    python fetch_pluto.py --borough BK   # Brooklyn instead

Borough codes: MN=Manhattan  BX=Bronx  BK=Brooklyn  QN=Queens  SI=Staten Island
"""

import argparse
import time
from pathlib import Path

import pandas as pd
import requests

# The PLUTO dataset lives at this Socrata endpoint. Returns JSON rows.
ENDPOINT = "https://data.cityofnewyork.us/resource/64uk-42ks.json"

# Socrata caps a single response at 1,000 rows unless you ask for more.
# We page through the data in chunks of this size using $limit/$offset.
PAGE_SIZE = 50_000

# Only pull the fields we actually use — smaller, faster responses than
# grabbing all 70+ columns. `latitude`/`longitude` give us a point per lot;
# `the_geom` (the full polygon) is available too but much heavier, so we
# start with points and can upgrade later.
FIELDS = [
    "bbl",         # unique tax-lot ID
    "borough",     # MN / BX / BK / QN / SI
    "address",
    "yearbuilt",
    "numfloors",
    "bldgarea",
    "landuse",
    "zonedist1",
    "latitude",
    "longitude",
]

# Where the cleaned CSV lands.
OUT_DIR = Path(__file__).parent / "output"

# Friendly names for the CSV filename / log messages.
BOROUGH_NAMES = {
    "MN": "manhattan",
    "BX": "bronx",
    "BK": "brooklyn",
    "QN": "queens",
    "SI": "staten_island",
}


def fetch_borough(borough_code):
    """Page through the API and return every matching row as a list of dicts.

    We ask the server to do the filtering for us via Socrata's SoQL params:
      $select — only the columns we listed above
      $where  — only this borough, and only lots with a real year built
                (yearbuilt = 0 means vacant / unknown, which we don't want)
      $limit / $offset — the paging window
    """
    all_rows = []
    offset = 0

    while True:
        params = {
            "$select": ",".join(FIELDS),
            "$where": f"borough='{borough_code}' AND yearbuilt > 0",
            "$limit": PAGE_SIZE,
            "$offset": offset,
        }

        print(f"  fetching rows {offset:,}–{offset + PAGE_SIZE:,} ...")
        response = requests.get(ENDPOINT, params=params, timeout=60)
        response.raise_for_status()  # blow up loudly if the request failed
        rows = response.json()

        if not rows:
            break  # empty page = we've reached the end

        all_rows.extend(rows)
        offset += PAGE_SIZE
        time.sleep(0.5)  # be polite to the free public API

    return all_rows


def clean(rows):
    """Turn the raw rows into a tidy DataFrame with a `decade` column."""
    df = pd.DataFrame(rows)

    # These arrive from the API as text; convert to numbers so we can
    # compare and bucket them. Anything unparseable becomes NaN.
    numeric_cols = ["yearbuilt", "numfloors", "bldgarea", "latitude", "longitude"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    before = len(df)

    # Drop rows we can't place on the map or can't date. The API $where
    # already removed yearbuilt = 0, but this also catches missing coords
    # and any stray bad values.
    df = df.dropna(subset=["yearbuilt", "latitude", "longitude"])

    # Sanity floor: nothing in Manhattan predates European settlement (~1625),
    # so a "year" like 910 or 920 is a data-entry typo (a dropped leading "1").
    # Filtering these out keeps the decade color scale sensible in Stage 3.
    df = df[df["yearbuilt"] >= 1625]

    print(f"  kept {len(df):,} of {before:,} rows after cleaning")

    # Bucket the year into its decade: 1923 -> 1920, 2005 -> 2000.
    # Integer-divide by 10, then multiply back by 10.
    df["decade"] = (df["yearbuilt"] // 10 * 10).astype(int)

    return df


def main():
    parser = argparse.ArgumentParser(description="Fetch + clean NYC PLUTO data.")
    parser.add_argument(
        "--borough",
        default="MN",
        choices=BOROUGH_NAMES.keys(),
        help="Borough code to pull (default: MN = Manhattan)",
    )
    args = parser.parse_args()

    name = BOROUGH_NAMES[args.borough]
    print(f"Fetching PLUTO for {name} ({args.borough})...")

    rows = fetch_borough(args.borough)
    print(f"Got {len(rows):,} raw rows. Cleaning...")

    df = clean(rows)

    OUT_DIR.mkdir(exist_ok=True)
    out_path = OUT_DIR / f"{name}.csv"
    df.to_csv(out_path, index=False)
    print(f"Saved {len(df):,} rows -> {out_path}")

    # A quick peek so you can sanity-check the result.
    print("\nLots per decade:")
    print(df["decade"].value_counts().sort_index().to_string())


if __name__ == "__main__":
    main()
