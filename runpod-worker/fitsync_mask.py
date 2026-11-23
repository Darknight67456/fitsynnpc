"""
FitSync Module 4 — Mannequin-specific realism fixes for CatVTON (Phase 3 quality pass)

Why this file exists (observed on the Colab T4 run, 11 Nov 2026):
  1. Short-sleeved Jersey Padini came out with sleeves down to the forearms.
     Cause: official AutoMasker 'upper' masks torso + big arms + forearms, so the
     diffusion model is told to repaint the whole arm and fills it with fabric.
  2. Shirt hem ended in pointed / triangular shapes.
     Cause: official AutoMasker takes a convex hull of everything it masks
     (A-pose arms + torso) and then cuts out the protected legs, leaving
     diagonal hull edges and a V-notch at the crotch.
  3. Mannequin input was a raw UI screenshot (buttons, labels, small figure).

Fixes provided here (pure PIL + NumPy, no GPU needed, unit-testable on CPU):
  - reframe_mannequin_capture(): cut the mannequin out of the screenshot and
    centre it on a plain studio background at 768x1024.
  - build_fitsync_upper_mask(): rebuild the upper-body mask from DensePose body
    parts (no convex hull), with sleeve-length control and a straight hem.
"""

from typing import Any, Dict, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CANONICAL_SIZE = (768, 1024)

SLEEVE_LENGTHS = ("auto", "sleeveless", "short_sleeve", "long_sleeve")

# DensePose part indices (same as preprocessor.DENSE_INDEX_MAP / CatVTON cloth_masker.py)
_DP_TORSO = (1, 2)
_DP_HANDS = (3, 4)
_DP_FACE = (23, 24)
_DP_BIG_ARM_LEFT = (15, 17)
_DP_BIG_ARM_RIGHT = (16, 18)
_DP_FOREARMS = (19, 20, 21, 22)

# Fraction of the upper-arm length (from the shoulder) covered by a short sleeve.
SHORT_SLEEVE_ARM_FRACTION = 0.5


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation with a (2r+1) square kernel using PIL's MaxFilter."""
    if radius <= 0:
        return mask.copy()
    img = Image.fromarray(mask.astype(np.uint8) * 255)
    return np.asarray(img.filter(ImageFilter.MaxFilter(2 * radius + 1))) > 0


def _row_fill(mask: np.ndarray) -> np.ndarray:
    """For every row, fill the gap between the left-most and right-most True pixel."""
    out = np.zeros_like(mask, dtype=bool)
    rows = np.nonzero(mask.any(axis=1))[0]
    for y in rows:
        xs = np.nonzero(mask[y])[0]
        out[y, xs[0]: xs[-1] + 1] = True
    return out


# --------------------------------------------------------------------------- #
# 1. Clean mannequin framing
# --------------------------------------------------------------------------- #
def reframe_mannequin_capture(
    image: Image.Image,
    size: Tuple[int, int] = CANONICAL_SIZE,
    fill_ratio: float = 0.90,
    diff_threshold: float = 7.0,
    background: Optional[Tuple[int, int, int]] = None,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """
    Finds the mannequin in a FitSync 3D-viewer screenshot and re-renders it centred
    on a plain background, so CatVTON never sees UI chips, buttons or page whitespace.

    How it works:
      - The 3D viewer background is a smooth vertical gradient, so the median
        brightness of each row is a good background estimate.
      - Pixels clearly darker than their row background are "foreground".
      - The connected blob nearest the image centre is the mannequin (UI text is
        ignored because it is not connected to it).
      - The blob (plus its floor shadow) is scaled so it fills `fill_ratio` of the
        frame and pasted with a soft alpha edge on a flat background colour.

    Fails safe: if nothing sensible is found, the original image is returned with
    info["applied"] = False.
    """
    rgb_img = image.convert("RGB")
    rgb = np.asarray(rgb_img).astype(np.float32)
    h, w = rgb.shape[:2]
    lum = rgb.mean(axis=2)

    row_bg = np.median(lum, axis=1, keepdims=True)
    fg = (row_bg - lum) > diff_threshold
    fg_img = Image.fromarray(fg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))
    fg_arr = np.asarray(fg_img) > 0

    ys, xs = np.nonzero(fg_arr)
    if len(ys) == 0:
        return rgb_img, {"applied": False, "reason": "no_foreground_found"}

    # Seed = foreground pixel closest to the image centre
    k = int(np.argmin((ys - h / 2.0) ** 2 + (xs - w / 2.0) ** 2))
    comp_img = fg_img.copy()
    ImageDraw.floodfill(comp_img, (int(xs[k]), int(ys[k])), 128, thresh=0)
    comp = np.asarray(comp_img) == 128

    cys, cxs = np.nonzero(comp)
    x0, x1, y0, y1 = int(cxs.min()), int(cxs.max()), int(cys.min()), int(cys.max())
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    area_ratio = comp.sum() / float(h * w)

    # Sanity checks: a standing mannequin is tall, not tiny, and not the whole frame
    if area_ratio < 0.02 or bh < 0.25 * h or bh <= bw or (bw > 0.95 * w and bh > 0.95 * h):
        return rgb_img, {
            "applied": False,
            "reason": "implausible_mannequin_bbox",
            "bbox": [x0, y0, x1, y1],
            "area_ratio": round(float(area_ratio), 4),
        }

    # Fill interior holes (flood the outside from a border pixel)
    padded = Image.new("L", (w + 2, h + 2), 0)
    padded.paste(Image.fromarray(comp.astype(np.uint8) * 255), (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 77, thresh=0)
    solid = np.asarray(padded)[1:-1, 1:-1] != 77

    if background is None:
        ring = _dilate(solid, 7) & ~solid
        background = tuple(int(v) for v in np.median(rgb[ring], axis=0)) if ring.any() else (240, 240, 240)

    alpha = (
        Image.fromarray(solid.astype(np.uint8) * 255)
        .filter(ImageFilter.MinFilter(3))   # undo the MaxFilter growth
        .filter(ImageFilter.GaussianBlur(1.5))  # soft, anti-aliased edge
    )

    figure = rgb_img.crop((x0, y0, x1 + 1, y1 + 1))
    alpha = alpha.crop((x0, y0, x1 + 1, y1 + 1))
    tw, th = size
    scale = min(fill_ratio * th / bh, fill_ratio * tw / bw)
    nw, nh = max(1, round(bw * scale)), max(1, round(bh * scale))
    figure = figure.resize((nw, nh), Image.LANCZOS)
    alpha = alpha.resize((nw, nh), Image.LANCZOS)

    out = Image.new("RGB", size, background)
    out.paste(figure, ((tw - nw) // 2, (th - nh) // 2), alpha)
    return out, {
        "applied": True,
        "source_bbox": [x0, y0, x1, y1],
        "scale": round(float(scale), 3),
        "background_rgb": list(background),
    }


# --------------------------------------------------------------------------- #
# 2. Realistic upper-body garment mask
# --------------------------------------------------------------------------- #
def build_fitsync_upper_mask(
    densepose_mask: Optional[Image.Image],
    fallback_mask: Image.Image,
    sleeve_length: str = "auto",
    hem_extend_ratio: float = 0.04,
    garment_ease_ratio: float = 0.012,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """
    Builds the upper-body inpainting mask directly from DensePose body parts,
    replacing the official convex-hull mask for the FitSync mannequin.

    255 = repaint with garment, 0 = keep mannequin.

      torso   : DensePose torso, filled row-by-row, grown by `garment_ease_ratio`*W
                so the shirt can be a little looser than the body.
      sleeves : 'long_sleeve' / 'auto' -> upper arms + forearms
                'short_sleeve'          -> top half of each upper arm only
                'sleeveless'            -> no arm area
      hem     : straight horizontal cut `hem_extend_ratio`*H below the torso,
                filled across the torso width (no V-notch, no pointed corners).
      protect : hands + face always; forearms (+ lower upper arm) for short
                sleeves; whole arm for sleeveless.

    Falls back to `fallback_mask` (official AutoMasker output) if DensePose did
    not find a torso, and says so in the returned info dict.
    """
    if sleeve_length not in SLEEVE_LENGTHS:
        raise ValueError(f"sleeve_length must be one of {SLEEVE_LENGTHS}, got '{sleeve_length}'")

    fb = fallback_mask.convert("L")
    w, h = fb.size
    if densepose_mask is None:
        return fb, {"applied": False, "reason": "densepose_unavailable"}

    dp_img = densepose_mask.convert("L")
    if dp_img.size != (w, h):
        dp_img = dp_img.resize((w, h), Image.NEAREST)
    dp = np.asarray(dp_img)

    torso = np.isin(dp, _DP_TORSO)
    if torso.sum() < 0.005 * w * h:
        return fb, {"applied": False, "reason": "densepose_torso_not_detected"}

    ease = max(3, int(round(garment_ease_ratio * w)))
    tys, txs = np.nonzero(torso)
    torso_top, torso_bottom = int(tys.min()), int(tys.max())

    # --- torso body of the shirt
    body = _dilate(_row_fill(torso), ease)

    # --- straight hem: fill a band across the torso width, cut everything below
    hem_y = min(h - 1, torso_bottom + int(round(hem_extend_ratio * h)))
    band_top = torso_bottom - int(round(0.25 * (torso_bottom - torso_top)))
    lower_torso_x = txs[tys >= band_top]
    xl = max(0, int(lower_torso_x.min()) - ease)
    xr = min(w - 1, int(lower_torso_x.max()) + ease)
    body[band_top: hem_y + 1, xl: xr + 1] = True

    # --- sleeves
    forearms = np.isin(dp, _DP_FOREARMS)
    sleeve = np.zeros_like(torso)
    arm_protect = np.zeros_like(torso)
    arm_info = {}
    for side, ids in (("left", _DP_BIG_ARM_LEFT), ("right", _DP_BIG_ARM_RIGHT)):
        big = np.isin(dp, ids)
        if not big.any():
            arm_info[side] = "not_detected"
            continue
        ays = np.nonzero(big)[0]
        a_top, a_bot = int(ays.min()), int(ays.max())
        if sleeve_length in ("auto", "long_sleeve"):
            sleeve |= big
        elif sleeve_length == "short_sleeve":
            cut = a_top + int(round(SHORT_SLEEVE_ARM_FRACTION * (a_bot - a_top)))
            upper = big.copy()
            upper[cut + 1:, :] = False
            sleeve |= upper
            arm_protect |= big & ~upper
            arm_info[side] = {"arm_rows": [a_top, a_bot], "sleeve_cut_y": cut}
            continue
        else:  # sleeveless
            arm_protect |= big
        arm_info[side] = {"arm_rows": [a_top, a_bot]}

    if sleeve_length in ("auto", "long_sleeve"):
        sleeve |= forearms
    else:
        arm_protect |= forearms

    mask = body | _dilate(sleeve, ease)
    mask[hem_y + 1:, :] = False

    # --- protection (applied last so nothing re-grows into it)
    protect = _dilate(np.isin(dp, _DP_HANDS), ease) | np.isin(dp, _DP_FACE)
    if arm_protect.any():
        # do not let the arm protection bite into the shirt body itself
        protect |= _dilate(arm_protect, 2) & ~_row_fill(torso)
    mask &= ~protect

    # Soften stair-steps, keep it binary
    out = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(2))
    out = out.point(lambda p: 255 if p > 127 else 0)

    return out, {
        "applied": True,
        "sleeve_length": sleeve_length,
        "torso_rows": [torso_top, torso_bottom],
        "hem_y": hem_y,
        "arms": arm_info,
        "mask_area_ratio": round(float(np.asarray(out).astype(bool).mean()), 4),
    }
