"""
FitSync — build the local Demo Clothing Catalog from the team cloth dataset.

    python scripts/build_demo_catalog.py \
        --dataset "Dataset Cloth.zip" \
        --manifest FitSync_Cloth_manifest.json \
        --out public/demo-catalog

What it does
  1. Reads every image inside the dataset zip (including the nested zips) and
     matches it to a manifest item by original_sha256. Nothing is trusted by
     file name alone.
  2. Excludes anything that is not a garment photo (mannequin / avatar
     references) and anything whose source file is missing.
  3. Writes web-ready JPEGs (EXIF-rotated, long side <= 1600 px, no upscaling)
     at the manifest's image_path, plus 480 px thumbnails for the grid.
  4. Writes catalog.json. Every item keeps review.status = "pending",
     review.category = null and review.rights_confirmed = false. The categories
     below are only SUGGESTIONS from a visual pass and must be confirmed by a
     human in the Demo Catalog page before anything is imported to Supabase.

Output is meant to stay git-ignored until rights are confirmed.
"""

import argparse
import hashlib
import io
import json
import os
import zipfile
from datetime import datetime, timezone

from PIL import Image, ImageOps

WEB_MAX_SIDE = 1600
THUMB_MAX_SIDE = 480

# Roles that are never clothing
NON_GARMENT_ROLES = {"avatar_reference"}

ORIGIN = {
    "edited_clothing": {
        "label": "AI-edited demo image",
        "detail": "Synthetic edit (ChatGPT). Not a photo of a real owned garment.",
    },
    "team_photos_part_1": {
        "label": "Team photo",
        "detail": "Phone photo by the FitSync team. Ownership and consent to use not yet confirmed.",
    },
    "team_photos_part_2": {
        "label": "Team photo",
        "detail": "Phone photo by the FitSync team. Ownership and consent to use not yet confirmed.",
    },
    "catalog_references": {
        "label": "Catalog reference",
        "detail": "Product-style reference image, likely from a third-party store. Do not treat as user-owned.",
    },
}

# ---------------------------------------------------------------------------
# Visual-pass SUGGESTIONS, in manifest order per source group.
# (category, sleeve_length, note). None = unclear, needs a human decision.
# Categories follow FitSync: top | bottom | outerwear | dress | shoes | accessory
# ---------------------------------------------------------------------------
S, L, N = "short_sleeve", "long_sleeve", "sleeveless"
SUGGESTIONS = {
    "edited_clothing": [
        ("top", S, "Third-party character print"),
        ("top", S, "Third-party character print"),
        ("outerwear", L, "Open jacket layered over a printed tee (third-party character print)"),
        ("top", S, None), ("top", S, None),
        ("outerwear", L, None),
        ("top", S, None), ("top", S, None), ("top", S, None), ("top", S, None),
        ("top", S, None), ("top", S, None),
        ("top", L, "Hooded top"),
        ("top", L, None),
        ("top", S, None),
        ("top", L, "Button-up shirt"),
        ("top", S, None), ("top", S, None), ("top", S, None), ("top", S, None),
        ("top", S, None), ("top", S, None), ("top", S, None), ("top", S, None),
        ("top", S, "Shown on a display form"),
        ("top", S, "Shown on a display form"),
        ("top", S, None),
        ("top", S, "Shown on a display form with trousers"),
        ("top", S, "Shown on a display form with trousers"),
    ],
    "team_photos_part_1": [
        ("top", L, None),
        ("bottom", None, None),
        (None, None, "Unclear: black item with drawstrings (bag or top?)"),
        ("bottom", None, None),
        ("top", L, "Same garment as another photo in this group"),
        ("top", L, "Folded in photo"),
        ("top", S, None),
        ("bottom", None, None),
        ("top", L, "Button-up shirt"),
        ("outerwear", L, "Blazer"),
        ("top", S, None),
        ("bottom", None, None),
        ("top", L, "Same garment as another photo in this group"),
        ("dress", L, "Long printed dress"),
        ("bottom", None, None),
        ("top", S, None),
        ("bottom", None, None),
        ("top", S, None), ("top", S, None),
        ("bottom", None, "Skirt"),
        ("top", L, None),
        ("top", L, "Folded in photo"),
        ("top", L, None),
    ],
    "team_photos_part_2": [
        ("bottom", None, None),
        ("shoes", None, "Loafers"),
        ("top", S, None), ("top", S, None), ("top", S, None), ("top", S, None),
        ("bottom", None, "Long skirt"),
        ("bottom", None, None),
        ("top", S, "Long oversized tee"),
        ("top", L, "Jersey-style top"),
        ("bottom", None, None),
        ("top", S, "Sports jersey"),
        ("top", L, None),
        ("bottom", None, None), ("bottom", None, None), ("bottom", None, None),
        ("top", S, None),
        ("bottom", None, "Shorts"),
        ("top", S, "Polo"),
        ("top", S, None),
        ("bottom", None, None),
        ("shoes", None, "Sneakers"),
        ("top", S, "Same garment as another photo in this group"),
        ("top", S, "Same garment as another photo in this group"),
        ("bottom", None, None), ("bottom", None, None), ("bottom", None, None),
        ("dress", L, "Folded; confirm whether dress or top"),
    ],
    "catalog_references": [
        ("outerwear", L, "Leather jacket"),
        ("bottom", None, None), ("bottom", None, None), ("bottom", None, None),
        ("top", L, "Knit sweater"),
        ("bottom", None, None),
        ("outerwear", L, "Denim jacket"),
        ("bottom", None, None),
        ("top", L, None),
        ("top", N, "Knit vest"),
        ("bottom", None, None),
        ("bottom", None, "Skirt"),
        ("top", L, None),
        ("bottom", None, None),
        ("top", L, None),
        ("outerwear", L, "Cardigan"),
        ("top", L, None),
        ("outerwear", L, "Cardigan"),
        ("top", L, None), ("top", L, None),
        ("bottom", None, None),
        ("top", L, None),
        ("bottom", None, None),
        ("outerwear", L, "Cardigan"),
        ("bottom", None, None), ("bottom", None, None),
        ("bottom", None, None), ("bottom", None, None),
        ("top", L, None),
        ("bottom", None, "Cargo trousers"),
        ("bottom", None, "Long skirt"),
    ],
}


def iter_zip_images(zf, prefix=""):
    """Yield (inner_path, bytes) for every image, descending into nested zips."""
    for info in zf.infolist():
        if info.is_dir():
            continue
        data = zf.read(info)
        name = prefix + info.filename
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as inner:
                yield from iter_zip_images(inner, prefix=name + "!/")
        elif name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            yield name, data


def save_resized(img, path, max_side, quality):
    w, h = img.size
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return img.size, os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--selection", default=os.path.join(os.path.dirname(__file__), "demo_catalog_selection.json"),
                    help="Garments to keep, with team-confirmed categories. Use '' to keep everything.")
    args = ap.parse_args()

    manifest = json.load(open(args.manifest, encoding="utf-8"))
    selection = None
    if args.selection and os.path.exists(args.selection):
        selection = json.load(open(args.selection, encoding="utf-8"))["items"]

    by_sha = {}
    with zipfile.ZipFile(args.dataset) as zf:
        for name, data in iter_zip_images(zf):
            by_sha.setdefault(hashlib.sha256(data).hexdigest(), (name, data))

    group_pos = {}
    items, excluded = [], []
    for it in manifest["items"]:
        group = it["source_group"]
        if it["role"] in NON_GARMENT_ROLES:
            excluded.append({"id": it["id"], "source_path": it["source_path"],
                             "reason": "mannequin/avatar reference, not clothing"})
            continue
        found = by_sha.get(it["original_sha256"])
        if not found:
            excluded.append({"id": it["id"], "source_path": it["source_path"],
                             "reason": "source file not found in dataset (sha256 mismatch)"})
            continue

        idx = group_pos.get(group, 0)
        group_pos[group] = idx + 1
        sugg = SUGGESTIONS[group][idx]
        chosen = selection.get(it["id"]) if selection is not None else None
        if selection is not None and not chosen:
            excluded.append({"id": it["id"], "source_path": it["source_path"],
                             "reason": "not selected for the demo catalog"})
            continue

        img = ImageOps.exif_transpose(Image.open(io.BytesIO(found[1]))).convert("RGB")
        rel = os.path.splitext(it["image_path"])[0] + ".jpg"
        thumb_rel = rel.replace("images/", "thumbs/", 1)
        (ww, wh), wbytes = save_resized(img, os.path.join(args.out, rel), WEB_MAX_SIDE, 86)
        (tw, th), _ = save_resized(img, os.path.join(args.out, thumb_rel), THUMB_MAX_SIDE, 80)

        flags = []
        if group == "edited_clothing":
            flags.append("synthetic_edit")
        if group == "catalog_references":
            flags.append("third_party_source_likely")
        if group.startswith("team_photos"):
            flags.append("photo_background_not_removed")
        if sugg[2] and "third-party character" in sugg[2].lower():
            flags.append("third_party_graphic")
        if sugg[2] and "Same garment" in sugg[2]:
            flags.append("possible_duplicate")
        if sugg[0] is None and not chosen:
            flags.append("category_unclear")

        items.append({
            "id": it["id"],
            "image": rel,
            "thumb": thumb_rel,
            "width": ww,
            "height": wh,
            "bytes": wbytes,
            "thumb_width": tw,
            "thumb_height": th,
            "source_group": group,
            "role": it["role"],
            "origin": ORIGIN[group],
            "source_path": it["source_path"],
            "original_sha256": it["original_sha256"],
            "suggested": {
                "category": sugg[0],
                "sleeve_length": sugg[1],
                "note": sugg[2],
                "by": "visual pass (unconfirmed)",
            },
            "review": {
                "status": "pending",
                "category": chosen["category"] if chosen else None,
                "sleeve_length": chosen["sleeve_length"] if chosen else None,
                # "unisex" | "female" | "male"; None until the team sets it.
                "gender": chosen.get("gender") if chosen else None,
                "name": None,
                "rights_confirmed": False,
            },
            "flags": flags,
        })

    for g, n in group_pos.items():
        assert n == len(SUGGESTIONS[g]), f"{g}: {n} items but {len(SUGGESTIONS[g])} suggestions"

    out = {
        "schema": "fitsync-demo-catalog/1",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_manifest": {
            "dataset": manifest.get("dataset"),
            "version": manifest.get("version"),
            "notes": manifest.get("notes"),
            "item_count": len(manifest["items"]),
        },
        "policy": {
            "production_import": "blocked until each item is reviewed and rights are confirmed",
            "storage": "local, git-ignored; never written to the clothing_items table",
        },
        "items": items,
        "excluded": excluded,
    }
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"catalog items: {len(items)}  excluded: {len(excluded)}")
    for e in excluded:
        print("  excluded:", e["source_path"], "-", e["reason"])


if __name__ == "__main__":
    main()
