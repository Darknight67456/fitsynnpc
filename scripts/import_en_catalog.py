#!/usr/bin/env python3
"""Add the reviewed English catalog (catalog-review/fitsync-catalog.en.json) to the Demo Catalog.

    python scripts/import_en_catalog.py \
        --catalog catalog-review/fitsync-catalog.en.json \
        --images "<folder the archive was extracted to>" \
        --out public/demo-catalog

Re-running replaces the items this script added before; the other catalog items are kept.
Byte-identical duplicates are listed under `excluded` instead of getting a second card.
Everything imported stays a suggestion: review status 'pending', rights not confirmed.
"""
import argparse
import json
import os
import re
from datetime import date

from PIL import Image, ImageOps

GROUP = "fashion_catalog"
WEB_MAX_SIDE = 1600
THUMB_MAX_SIDE = 480
ORIGIN = {
    "label": "Fashion catalog",
    "detail": "Product photo from the 2026-11 fashion catalog, likely from third-party shops. "
              "Classified by an image review; confirm usage rights before production use.",
}


def save_resized(img, path, max_side, quality):
    w, h = img.size
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return img.size, os.path.getsize(path)


def sleeve_from_evidence(category, evidence):
    """Sleeve hint for the 3D garment shape and CatVTON mask, read from the review's own evidence."""
    if category not in ("top", "outerwear", "dress"):
        return None
    text = " ".join(evidence).lower()
    if "sleeveless" in text or "strap" in text or "halter" in text or "strapless" in text:
        return "sleeveless"
    if "long sleeve" in text or "long-sleeve" in text or "long sleeves" in text or "bell sleeves" in text \
            or "balloon sleeves" in text or "bishop sleeves" in text or "puffed sleeves" in text:
        return "long_sleeve"
    if "short sleeve" in text or "short sleeves" in text or "cap sleeves" in text or "short-sleeve" in text:
        return "short_sleeve"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    source = json.load(open(args.catalog, encoding="utf-8"))
    cat_path = os.path.join(args.out, "catalog.json")
    demo = json.load(open(cat_path, encoding="utf-8"))
    demo["items"] = [i for i in demo["items"] if i.get("source_group") != GROUP]
    demo["excluded"] = [e for e in demo["excluded"] if not e.get("source_path", "").startswith(f"{GROUP}:")]
    taken = {i["id"] for i in demo["items"]}

    added = 0
    for rec in source["items"]:
        src_label = f"{GROUP}:{rec['image_path']}"
        if rec["duplicate_of"]:
            demo["excluded"].append({"id": rec["id"], "source_path": src_label,
                                     "reason": f"byte-identical duplicate of {rec['duplicate_of']}"})
            continue
        if rec["review_status"] == "no_item":
            demo["excluded"].append({"id": rec["id"], "source_path": src_label, "reason": "no garment in image"})
            continue
        if rec["id"] in taken:
            raise SystemExit(f"id clash with an existing catalog item: {rec['id']}")

        img = ImageOps.exif_transpose(Image.open(os.path.join(args.images, rec["image_path"]))).convert("RGB")
        stem = re.sub(r"[^A-Za-z0-9]+", "-", rec["display_name"]).strip("-").lower()[:48]
        rel = f"images/{GROUP}/{rec['id']}-{stem}.jpg"
        thumb_rel = rel.replace("images/", "thumbs/", 1)
        (ww, wh), wbytes = save_resized(img, os.path.join(args.out, rel), WEB_MAX_SIDE, 86)
        (tw, th), _ = save_resized(img, os.path.join(args.out, thumb_rel), THUMB_MAX_SIDE, 80)

        flags = ["third_party_source_likely"]
        if rec["review_status"] == "needs_review":
            flags.append("needs_manual_review")
        if rec["item_kind"] in ("set", "uncertain"):
            flags.append("set_contents_unconfirmed" if rec["item_kind"] == "set" else "item_kind_unclear")

        demo["items"].append({
            "id": rec["id"],
            "image": rel,
            "thumb": thumb_rel,
            "width": ww,
            "height": wh,
            "bytes": wbytes,
            "thumb_width": tw,
            "thumb_height": th,
            "source_group": GROUP,
            "role": "catalog_item",
            "origin": ORIGIN,
            "source_path": rec["image_path"],
            "original_sha256": rec["sha256"],
            "display_name": rec["display_name"],
            "details": {
                "garment_type": rec["garment_type"],
                "item_kind": rec["item_kind"],
                "occasions": rec["occasions"],
                "themes": rec["themes"],
                "visual_evidence": rec["visual_evidence"],
                "review_status": rec["review_status"],
                "review_note": rec["review_note"],
            },
            "suggested": {
                "category": rec["category"],
                "sleeve_length": sleeve_from_evidence(rec["category"], rec["visual_evidence"]),
                "gender": rec["gender"],
                "note": rec["review_note"],
                "by": f"image review {source['generated_on']} (unconfirmed)",
            },
            "review": {
                "status": "pending",
                "category": None,
                "name": None,
                "rights_confirmed": False,
                "sleeve_length": None,
                "gender": None,
            },
            "flags": flags,
        })
        added += 1

    demo.setdefault("imports", [])
    demo["imports"] = [i for i in demo["imports"] if i.get("source_group") != GROUP]
    demo["imports"].append({"source_group": GROUP, "source_archive": source["source_archive"],
                            "catalog_schema": source["schema"], "imported_on": date.today().isoformat(),
                            "items": added})
    json.dump(demo, open(cat_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"added {added} items from {source['source_archive']}; catalog now has {len(demo['items'])} items")


if __name__ == "__main__":
    main()
