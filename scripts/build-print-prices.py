"""Build the wildlife print price list from the WHCC cost spreadsheet.

Source of truth: "WHCC Fine Art Print Pricing.xlsx" (default: the GitHub folder
one level above this repo), sheet "Fine Art Prints". Row 5 holds the column
headers; each row below it is one print size. Columns are found by header name,
so moving them around in Excel is fine.

Every cost is turned into a selling price with a MARGIN (share of the selling
price that is profit):

    price = cost / (1 - MARGIN)        MARGIN = 0.50  ->  price = cost x 2

Only the selling prices are written to the site (wildlife/data/print-prices.json).
The costs stay in the spreadsheet, so customers can't see them.

Run by hand after editing the spreadsheet, then commit and push:
  python scripts/build-print-prices.py [path-to-xlsx]
"""

import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date

MARGIN = 0.50  # 50% margin: half of every sale is profit

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLSX = os.path.join(os.path.dirname(REPO), "WHCC Fine Art Print Pricing.xlsx")
OUT = os.path.join(REPO, "wildlife", "data", "print-prices.json")
SHEET = "Fine Art Prints"

# Dropdown options, in display order: (id, paper group, label, spreadsheet header)
MOUNTINGS = [
    ("matte", "Smooth Matte paper", "Smooth Matte, no mounting", "Smooth Matte - Normal Cost (no mounting)"),
    ("matte-matboard", "Smooth Matte paper", "Smooth Matte on matboard", "Smooth Matte + Matboard"),
    ("matte-styrene", "Smooth Matte paper", "Smooth Matte on styrene", "Smooth Matte + Styrene"),
    ("premium", "Premium fine art paper", "Premium paper, no mounting", "Premium Papers - Normal Cost (no mounting)"),
    ("premium-matboard", "Premium fine art paper", "Premium paper on matboard", "Premium + Matboard"),
    ("premium-styrene", "Premium fine art paper", "Premium paper on styrene", "Premium + Styrene"),
]

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def col_index(ref):
    """'C12' -> 2"""
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def read_sheet(path, name):
    """Return the sheet as a list of rows (list of cell values, '' for blanks).
    Formula cells give the value Excel last calculated and saved."""
    with zipfile.ZipFile(path) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si"):
                strings.append("".join(t.text or "" for t in si.iter(M + "t")))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        target = None
        for sh in ET.fromstring(z.read("xl/workbook.xml")).find(M + "sheets"):
            if sh.get("name") == name:
                target = rels[sh.get(R + "id")]
        if target is None:
            sys.exit(f'No sheet named "{name}" in {path}')
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(M + "row"):
            cells = {}
            for c in row.findall(M + "c"):
                v = c.find(M + "v")
                val = v.text if v is not None else ""
                if c.get("t") == "s" and val != "":
                    val = strings[int(val)]
                elif c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(M + "t"))
                cells[col_index(c.get("r"))] = val
            width = max(cells) + 1 if cells else 0
            rows.append([cells.get(i, "") for i in range(width)])
        return rows


def to_cost(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None  # "N/A" or blank: not offered
    return x if x > 0 else None


def sell_price(cost):
    # round up to the cent so the margin is never under target
    return math.ceil(round(cost / (1 - MARGIN) * 100, 6)) / 100


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    if not os.path.exists(src):
        sys.exit(f"Spreadsheet not found: {src}")
    rows = read_sheet(src, SHEET)

    header_i = next((i for i, r in enumerate(rows) if r and str(r[0]).strip().lower() == "size"), None)
    if header_i is None:
        sys.exit('Could not find the header row (first cell "Size").')
    header = [str(h).strip() for h in rows[header_i]]
    cols = {}
    for mid, _, _, head in MOUNTINGS:
        if head not in header:
            sys.exit(f'Column "{head}" is missing from the header row.')
        cols[mid] = header.index(head)

    sizes = []
    for r in rows[header_i + 1:]:
        size = str(r[0]).strip() if r else ""
        # data rows look like "8×10" or "Mini Snapshot"; stop at the notes below the table
        if not size or size.lower().startswith(("color key", "assumption")):
            if sizes:
                break
            continue
        prices = {}
        for mid, col in cols.items():
            cost = to_cost(r[col] if col < len(r) else "")
            if cost is not None:
                prices[mid] = sell_price(cost)
        if prices:
            sizes.append({"size": re.sub(r"(\d)\s*[xX]\s*(\d)", "\1×\2", size), "prices": prices})

    data = {
        "_note": "Generated by scripts/build-print-prices.py from the WHCC cost spreadsheet. Do not edit by hand.",
        "updated": date.today().isoformat(),
        "mountings": [{"id": m, "group": g, "label": l} for m, g, l, _ in MOUNTINGS],
        "sizes": sizes,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {len(sizes)} sizes x {len(MOUNTINGS)} mountings to {os.path.relpath(OUT, REPO)} "
          f"({int(MARGIN * 100)}% margin)")


if __name__ == "__main__":
    main()
