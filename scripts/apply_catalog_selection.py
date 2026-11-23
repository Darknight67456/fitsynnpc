"""
Trim an existing public/demo-catalog to the garments in demo_catalog_selection.json.

    python scripts/apply_catalog_selection.py \
        --catalog public/demo-catalog \
        --selection scripts/demo_catalog_selection.json \
        --backup ../_backup_catalog_trim

- Items in the selection stay, with review.category and review.sleeve_length set
  to the team-confirmed values. Review status and usage rights are left as they are.
- Every other item is listed under "excluded" and its image + thumbnail are MOVED
  into --backup (not deleted), together with the previous catalog.json.
"""

import argparse
import json
import os
import shutil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--selection", required=True)
    ap.add_argument("--backup", required=True)
    args = ap.parse_args()

    cat_path = os.path.join(args.catalog, "catalog.json")
    catalog = json.load(open(cat_path, encoding="utf-8"))
    selection = json.load(open(args.selection, encoding="utf-8"))["items"]

    missing = [i for i in selection if i not in {it["id"] for it in catalog["items"]}]
    if missing:
        raise SystemExit(f"selection ids not in catalog: {missing}")

    os.makedirs(args.backup, exist_ok=True)
    shutil.copy2(cat_path, os.path.join(args.backup, "catalog.before-trim.json"))

    kept, moved = [], 0
    excluded = list(catalog.get("excluded", []))
    for it in catalog["items"]:
        chosen = selection.get(it["id"])
        if chosen:
            it["review"]["category"] = chosen["category"]
            it["review"]["sleeve_length"] = chosen["sleeve_length"]
            it["flags"] = [f for f in it.get("flags", []) if f != "category_unclear"]
            kept.append(it)
            continue
        for rel in (it["image"], it["thumb"]):
            src = os.path.join(args.catalog, rel)
            if os.path.exists(src):
                dst = os.path.join(args.backup, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                moved += 1
        excluded.append({"id": it["id"], "source_path": it["source_path"],
                         "reason": "not selected for the demo catalog"})

    catalog["items"] = kept
    catalog["excluded"] = excluded
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1, ensure_ascii=False)
    print(f"kept {len(kept)} items, excluded {len(excluded)}, moved {moved} files to {args.backup}")


if __name__ == "__main__":
    main()
