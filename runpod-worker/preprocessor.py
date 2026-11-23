"""
FitSync Module 4 — CatVTON Preprocessor (Phase 2: Official Gradio Flow + AutoMasker Support)
Handles image decoding, official CatVTON resize_and_crop / resize_and_padding (768x1024),
category-to-AutoMasker mapping ('upper_body' -> 'upper', 'lower_body' -> 'lower', 'dresses' -> 'overall'),
DensePose + SCHP cloth-agnostic mask computation, torso/head region verification,
and input payload sanitation without exposing secrets or raw image bytes in logs.
"""

import base64
import io
import re
from typing import Any, Dict, Optional, Tuple, Union
from PIL import Image, ImageChops, ImageFilter, ImageOps
import requests

CANONICAL_WIDTH = 768
CANONICAL_HEIGHT = 1024

# Official mapping between FitSync / dataset categories and CatVTON AutoMasker parts
# Verified against Zheng-Chong/CatVTON/preprocess_agnostic_mask.py & app.py
CATEGORY_TO_AUTOMASKER_PART: Dict[str, str] = {
    "upper_body": "upper",
    "upper": "upper",
    "lower_body": "lower",
    "lower": "lower",
    "dresses": "overall",
    "overall": "overall",
}

SUPPORTED_CATEGORIES = set(CATEGORY_TO_AUTOMASKER_PART.keys())

# Official DensePose and SCHP label mappings from Zheng-Chong/CatVTON/model/cloth_masker.py
DENSE_INDEX_MAP: Dict[str, list] = {
    "background": [0],
    "torso": [1, 2],
    "right hand": [3],
    "left hand": [4],
    "right foot": [5],
    "left foot": [6],
    "right thigh": [7, 9],
    "left thigh": [8, 10],
    "right leg": [11, 13],
    "left leg": [12, 14],
    "left big arm": [15, 17],
    "right big arm": [16, 18],
    "left forearm": [19, 21],
    "right forearm": [20, 22],
    "face": [23, 24],
    "thighs": [7, 8, 9, 10],
    "legs": [11, 12, 13, 14],
    "hands": [3, 4],
    "feet": [5, 6],
    "big arms": [15, 16, 17, 18],
    "forearms": [19, 20, 21, 22],
}

ATR_MAPPING: Dict[str, int] = {
    "Background": 0,
    "Hat": 1,
    "Hair": 2,
    "Sunglasses": 3,
    "Upper-clothes": 4,
    "Skirt": 5,
    "Pants": 6,
    "Dress": 7,
    "Belt": 8,
    "Left-shoe": 9,
    "Right-shoe": 10,
    "Face": 11,
    "Left-leg": 12,
    "Right-leg": 13,
    "Left-arm": 14,
    "Right-arm": 15,
    "Bag": 16,
    "Scarf": 17,
}

LIP_MAPPING: Dict[str, int] = {
    "Background": 0,
    "Hat": 1,
    "Hair": 2,
    "Glove": 3,
    "Sunglasses": 4,
    "Upper-clothes": 5,
    "Dress": 6,
    "Coat": 7,
    "Socks": 8,
    "Pants": 9,
    "Jumpsuits": 10,
    "Scarf": 11,
    "Skirt": 12,
    "Face": 13,
    "Left-arm": 14,
    "Right-arm": 15,
    "Left-leg": 16,
    "Right-leg": 17,
    "Left-shoe": 18,
    "Right-shoe": 19,
}

PROTECT_BODY_PARTS: Dict[str, list] = {
    "upper": ["Left-leg", "Right-leg"],
    "lower": ["Right-arm", "Left-arm", "Face"],
    "overall": [],
    "inner": ["Left-leg", "Right-leg"],
    "outer": ["Left-leg", "Right-leg"],
}

PROTECT_CLOTH_PARTS: Dict[str, Dict[str, list]] = {
    "upper": {"ATR": ["Skirt", "Pants"], "LIP": ["Skirt", "Pants"]},
    "lower": {"ATR": ["Upper-clothes"], "LIP": ["Upper-clothes", "Coat"]},
    "overall": {"ATR": [], "LIP": []},
    "inner": {
        "ATR": ["Dress", "Coat", "Skirt", "Pants"],
        "LIP": ["Dress", "Coat", "Skirt", "Pants", "Jumpsuits"],
    },
    "outer": {
        "ATR": ["Dress", "Pants", "Skirt"],
        "LIP": ["Upper-clothes", "Dress", "Pants", "Skirt", "Jumpsuits"],
    },
}

MASK_CLOTH_PARTS: Dict[str, list] = {
    "upper": ["Upper-clothes", "Coat", "Dress", "Jumpsuits"],
    "lower": ["Pants", "Skirt", "Dress", "Jumpsuits"],
    "overall": ["Upper-clothes", "Dress", "Pants", "Skirt", "Coat", "Jumpsuits"],
    "inner": ["Upper-clothes"],
    "outer": ["Coat"],
}

MASK_DENSE_PARTS: Dict[str, list] = {
    "upper": ["torso", "big arms", "forearms"],
    "lower": ["thighs", "legs"],
    "overall": ["torso", "thighs", "legs", "big arms", "forearms"],
    "inner": ["torso"],
    "outer": ["torso", "big arms", "forearms"],
}


def map_category_to_automasker_part(category: str) -> str:
    """
    Maps a FitSync or CatVTON category identifier ('upper_body', 'lower_body', 'dresses',
    'upper', 'lower', 'overall') to the exact `mask_type` expected by `AutoMasker`.
    """
    if not isinstance(category, str) or category not in CATEGORY_TO_AUTOMASKER_PART:
        raise ValueError(
            f"Unsupported category '{category}'. Must be one of {sorted(SUPPORTED_CATEGORIES)}"
        )
    return CATEGORY_TO_AUTOMASKER_PART[category]


def sanitize_log_dict(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a copy of the input dictionary where large image payloads
    and sensitive strings are replaced with descriptive metadata summaries.
    """
    sanitized = {}
    for k, v in d.items():
        if isinstance(v, str):
            if any(secret in k.lower() for secret in ["key", "token", "auth", "secret"]):
                sanitized[k] = "<redacted>"
            elif v.startswith("data:image/") or len(v) > 500:
                sanitized[k] = f"<base64_image_len_{len(v)}>"
            else:
                sanitized[k] = v
        elif isinstance(v, dict):
            sanitized[k] = sanitize_log_dict(v)
        else:
            sanitized[k] = v
    return sanitized


def decode_image(image_input: str, max_bytes: int = 15 * 1024 * 1024) -> Image.Image:
    """
    Safely decodes an image from a base64 string, data URI, or HTTP(S) URL.
    Enforces maximum payload size and converts output to RGB.
    """
    if not isinstance(image_input, str) or not image_input.strip():
        raise ValueError("Image input must be a non-empty string (URL or base64)")

    raw_bytes: bytes

    if image_input.startswith("http://") or image_input.startswith("https://"):
        resp = requests.get(image_input, timeout=12, stream=True)
        resp.raise_for_status()
        content = bytearray()
        for chunk in resp.iter_content(chunk_size=65536):
            content.extend(chunk)
            if len(content) > max_bytes:
                raise ValueError(f"Downloaded image exceeds maximum allowed size ({max_bytes} bytes)")
        raw_bytes = bytes(content)
    else:
        b64_str = image_input
        if "base64," in b64_str:
            b64_str = b64_str.split("base64,")[1]
        b64_str = re.sub(r"\s+", "", b64_str)
        if not b64_str:
            raise ValueError("Base64 image string is empty")
        try:
            raw_bytes = base64.b64decode(b64_str, validate=True)
        except Exception as e:
            raise ValueError(f"Failed to decode base64 image data: {str(e)}")

        if len(raw_bytes) > max_bytes:
            raise ValueError(f"Decoded base64 image exceeds maximum allowed size ({max_bytes} bytes)")

    try:
        pil_img = Image.open(io.BytesIO(raw_bytes))
        pil_img.load()
    except Exception as e:
        raise ValueError(f"Invalid or corrupted image format: {str(e)}")

    pil_img = ImageOps.exif_transpose(pil_img)
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")

    return pil_img


def encode_image_to_base64(image: Image.Image, format: str = "PNG") -> str:
    """Encodes a PIL Image to a base64 PNG data string."""
    buf = io.BytesIO()
    image.save(buf, format=format, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/{format.lower()};base64,{b64}"


def resize_and_crop(
    image: Image.Image,
    size: Tuple[int, int] = (CANONICAL_WIDTH, CANONICAL_HEIGHT),
) -> Image.Image:
    """
    Official CatVTON person/mask preprocessing from `utils.py`:
    Center-crops the image to match the target aspect ratio (3:4) and resizes to (768, 1024).
    """
    w, h = image.size
    if w <= 0 or h <= 0:
        raise ValueError("Image dimensions must be positive")
    target_w, target_h = size
    if w / h < target_w / target_h:
        new_w = w
        new_h = max(1, w * target_h // target_w)
    else:
        new_h = h
        new_w = max(1, h * target_w // target_h)

    cropped = image.crop(
        ((w - new_w) // 2, (h - new_h) // 2, (w + new_w) // 2, (h + new_h) // 2)
    )
    resample = Image.NEAREST if image.mode == "L" else Image.LANCZOS
    return cropped.resize(size, resample)


def resize_and_padding(
    image: Image.Image,
    size: Tuple[int, int] = (CANONICAL_WIDTH, CANONICAL_HEIGHT),
) -> Image.Image:
    """
    Official CatVTON garment (`condition_image`) preprocessing from `utils.py`:
    Resizes the garment preserving aspect ratio and centers it on a white (255, 255, 255) canvas.
    """
    w, h = image.size
    if w <= 0 or h <= 0:
        raise ValueError("Image dimensions must be positive")
    target_w, target_h = size
    if w / h < target_w / target_h:
        new_h = target_h
        new_w = max(1, w * target_h // h)
    else:
        new_w = target_w
        new_h = max(1, h * target_w // w)

    resized = image.resize((new_w, new_h), Image.LANCZOS)
    padding = Image.new("RGB", size, (255, 255, 255))
    padding.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return padding


def resize_and_pad(
    image: Image.Image,
    target_size: Tuple[int, int] = (CANONICAL_WIDTH, CANONICAL_HEIGHT),
    is_mask: bool = False,
) -> Tuple[Image.Image, Tuple[int, int, int, int]]:
    """
    Resizes the image to fit within target_size (width, height) while preserving
    its native aspect ratio, then centers it on a padded canvas.
    """
    target_w, target_h = target_size
    orig_w, orig_h = image.size

    scale = min(target_w / orig_w, target_h / orig_h)
    new_w = max(1, int(orig_w * scale))
    new_h = max(1, int(orig_h * scale))

    resample_mode = Image.NEAREST if is_mask else Image.LANCZOS
    resized = image.resize((new_w, new_h), resample=resample_mode)

    pad_left = (target_w - new_w) // 2
    pad_top = (target_h - new_h) // 2
    box = (pad_left, pad_top, pad_left + new_w, pad_top + new_h)

    if is_mask:
        padded = Image.new("L", target_size, 0)
        if resized.mode != "L":
            resized = resized.convert("L")
        padded.paste(resized, (pad_left, pad_top))
    else:
        padded = Image.new("RGB", target_size, (255, 255, 255))
        padded.paste(resized, (pad_left, pad_top))

    return padded, box


def blur_agnostic_mask(mask: Image.Image, blur_factor: int = 9) -> Image.Image:
    """
    Matches `mask_processor.blur(mask, blur_factor=9)` in the official CatVTON Gradio `app.py` (line 167).
    Applies Gaussian smoothing to the binary mask edges before latent concatenation.
    """
    if mask.mode != "L":
        mask = mask.convert("L")
    try:
        from diffusers.image_processor import VaeImageProcessor

        processor = VaeImageProcessor(
            vae_scale_factor=8,
            do_normalize=False,
            do_binarize=True,
            do_convert_grayscale=True,
        )
        return processor.blur(mask, blur_factor=blur_factor)
    except ImportError:
        radius = max(1.0, blur_factor / 2.0)
        return mask.filter(ImageFilter.GaussianBlur(radius=radius))


def repaint_result(
    result_image: Image.Image,
    person_image: Image.Image,
    mask_image: Image.Image,
) -> Image.Image:
    """
    Official CatVTON post-processing (`utils.py:repaint_result`):
    Composites the generated garment onto the original person/mannequin image using the mask,
    guaranteeing 100% preservation of the unmasked faceless head, limbs, and background.
    """
    if result_image.size != person_image.size:
        result_image = result_image.resize(person_image.size, Image.LANCZOS)
    mask_l = mask_image.convert("L")
    if mask_l.size != person_image.size:
        mask_l = mask_l.resize(person_image.size, Image.NEAREST)
    return Image.composite(result_image.convert("RGB"), person_image.convert("RGB"), mask_l)


def _allowed_label_set(parts: Union[str, list], mapping: Dict[str, Union[int, list]]) -> set:
    if isinstance(parts, str):
        parts = [parts]
    allowed = set()
    for p in parts:
        if p not in mapping:
            continue
        val = mapping[p]
        if isinstance(val, list):
            allowed.update(val)
        else:
            allowed.add(val)
    return allowed


def compute_cloth_agnostic_mask(
    densepose_mask: Image.Image,
    schp_lip_mask: Image.Image,
    schp_atr_mask: Image.Image,
    part: str = "upper",
) -> Image.Image:
    """
    Computes the CatVTON cloth-agnostic mask from DensePose + SCHP (LIP & ATR) segmentation maps.
    Delegates to `model.cloth_masker.AutoMasker.cloth_agnostic_mask` when OpenCV/NumPy are installed,
    and provides an exact PIL fallback for lightweight CPU test environments.
    """
    if part in CATEGORY_TO_AUTOMASKER_PART:
        part = CATEGORY_TO_AUTOMASKER_PART[part]
    if part not in ("upper", "lower", "overall", "inner", "outer"):
        raise ValueError(
            f"part should be one of ['upper', 'lower', 'overall', 'inner', 'outer'], but got {part}"
        )

    try:
        from model.cloth_masker import AutoMasker  # type: ignore

        return AutoMasker.cloth_agnostic_mask(
            densepose_mask=densepose_mask,
            schp_lip_mask=schp_lip_mask,
            schp_atr_mask=schp_atr_mask,
            part=part,
        )
    except ImportError:
        pass

    # Pure-PIL implementation of official AutoMasker.cloth_agnostic_mask
    dp_l = densepose_mask.convert("L")
    w, h = dp_l.size
    lip_l = schp_lip_mask.convert("L").resize((w, h), Image.NEAREST)
    atr_l = schp_atr_mask.convert("L").resize((w, h), Image.NEAREST)

    dp_bytes = dp_l.tobytes()
    lip_bytes = lip_l.tobytes()
    atr_bytes = atr_l.tobytes()

    dense_hands_feet = _allowed_label_set(["hands", "feet"], DENSE_INDEX_MAP)
    dense_face = _allowed_label_set(["face"], DENSE_INDEX_MAP)
    lip_face = _allowed_label_set("Face", LIP_MAPPING)
    atr_face = _allowed_label_set("Face", ATR_MAPPING)

    body_protect_lip = _allowed_label_set(PROTECT_BODY_PARTS[part], LIP_MAPPING)
    body_protect_atr = _allowed_label_set(PROTECT_BODY_PARTS[part], ATR_MAPPING)
    hair_lip = _allowed_label_set(["Hair"], LIP_MAPPING)
    hair_atr = _allowed_label_set(["Hair"], ATR_MAPPING)
    cloth_protect_lip = _allowed_label_set(PROTECT_CLOTH_PARTS[part]["LIP"], LIP_MAPPING)
    cloth_protect_atr = _allowed_label_set(PROTECT_CLOTH_PARTS[part]["ATR"], ATR_MAPPING)

    accessory_names = [
        "Hat",
        "Glove",
        "Sunglasses",
        "Bag",
        "Left-shoe",
        "Right-shoe",
        "Scarf",
        "Socks",
    ]
    acc_lip = _allowed_label_set(accessory_names, LIP_MAPPING)
    acc_atr = _allowed_label_set(accessory_names, ATR_MAPPING)

    strong_cloth_lip = _allowed_label_set(MASK_CLOTH_PARTS[part], LIP_MAPPING)
    strong_cloth_atr = _allowed_label_set(MASK_CLOTH_PARTS[part], ATR_MAPPING)
    dense_target = _allowed_label_set(MASK_DENSE_PARTS[part], DENSE_INDEX_MAP)

    strong_protect_buf = bytearray(w * h)
    weak_protect_buf = bytearray(w * h)
    mask_candidate_buf = bytearray(w * h)
    strong_mask_buf = bytearray(w * h)

    for idx in range(w * h):
        d_val = dp_bytes[idx]
        l_val = lip_bytes[idx]
        a_val = atr_bytes[idx]

        is_strong_protect = (
            (d_val in dense_hands_feet)
            or (d_val in dense_face)
            or (l_val in lip_face)
            or (a_val in atr_face)
        )
        if is_strong_protect:
            strong_protect_buf[idx] = 255

        is_weak_protect = (
            is_strong_protect
            or (l_val in body_protect_lip)
            or (a_val in body_protect_atr)
            or (l_val in hair_lip)
            or (a_val in hair_atr)
            or (l_val in cloth_protect_lip)
            or (a_val in cloth_protect_atr)
            or (l_val in acc_lip)
            or (a_val in acc_atr)
        )
        if is_weak_protect:
            weak_protect_buf[idx] = 255

        is_strong_mask = (l_val in strong_cloth_lip) or (a_val in strong_cloth_atr)
        if is_strong_mask:
            strong_mask_buf[idx] = 255

        is_dense_target = d_val in dense_target
        is_bg = (l_val == 0) and (a_val == 0) and (d_val == 0)

        if (is_dense_target or is_strong_mask or not is_bg) and not is_weak_protect:
            if is_dense_target or is_strong_mask:
                mask_candidate_buf[idx] = 255

    mask_img = Image.frombytes("L", (w, h), bytes(mask_candidate_buf))
    strong_protect_img = Image.frombytes("L", (w, h), bytes(strong_protect_buf))
    weak_protect_img = Image.frombytes("L", (w, h), bytes(weak_protect_buf))
    strong_mask_img = Image.frombytes("L", (w, h), bytes(strong_mask_buf))

    # Morphological dilation + Gaussian smoothing + threshold (>=25) matching official cloth_masker.py
    mask_img = mask_img.filter(ImageFilter.MaxFilter(9))
    mask_img = ImageChops.subtract(mask_img, weak_protect_img)
    blur_radius = max(3, max(w, h) // 50)
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    mask_img = mask_img.point(lambda p: 255 if p >= 25 else 0)
    mask_img = ImageChops.lighter(mask_img, strong_mask_img)
    mask_img = ImageChops.subtract(mask_img, strong_protect_img)
    mask_img = mask_img.filter(ImageFilter.MaxFilter(5))
    mask_img = ImageChops.subtract(mask_img, strong_protect_img)
    return mask_img.point(lambda p: 255 if p > 127 else 0)


def validate_mask(
    mask: Image.Image,
    target_size: Tuple[int, int] = (CANONICAL_WIDTH, CANONICAL_HEIGHT),
) -> Image.Image:
    """
    Validates and normalizes an inpainting agnostic mask to 768x1024 mode 'L'.
    Enforces:
      0   (black) = preserve (head, face, hands, background)
      255 (white) = inpaint / regenerate with garment
    """
    if not isinstance(mask, Image.Image):
        raise ValueError("Mask must be a valid PIL.Image.Image")

    if mask.mode != "L":
        mask = mask.convert("L")

    if mask.size != target_size:
        mask = resize_and_crop(mask, size=target_size)

    # Binarize threshold at 128
    mask = mask.point(lambda p: 255 if p > 127 else 0)

    extrema = mask.getextrema()
    if extrema == (0, 0):
        raise ValueError("Invalid mask: mask is completely black (no inpainting region specified)")
    if extrema == (255, 255):
        raise ValueError("Invalid mask: mask is completely white (entire image would be erased)")

    return mask


def enforce_faceless_mannequin_head_protection(
    mask: Image.Image,
    densepose_mask: Optional[Image.Image] = None,
    category: str = "upper_body",
) -> Image.Image:
    """
    Hardens an AutoMasker (DensePose + SCHP) binary mask for the FitSync faceless 3D mannequin:
      1. Upstream `cloth_masker.py` only checks `schp_lip_mask == Face (13)` for `face_protect_area`.
         Because our studio mannequin is faceless (no eyes/nose/mouth), SCHP can misclassify the smooth
         white head as clothing/body, causing `hull_mask` to extend over the head.
      2. This function explicitly zeroes out (`0` = preserve):
         - Any pixel classified as `face` (`[23, 24]`) or `hands`/`feet` (`[3, 4, 5, 6]`) in `densepose_mask`.
         - The anatomical head zone above the collar (`y < 0.165 * H`, or above `torso_top_y - 0.015 * H`
           when DensePose detects torso `[1, 2]`).
    """
    part = map_category_to_automasker_part(category)
    mask_l = mask.convert("L")
    w, h = mask_l.size
    mask_bytes = bytearray(mask_l.tobytes())

    # Default anatomical head ceiling for 768x1024 front-view mannequin (head spans 0.065H..0.175H)
    head_ceiling_y = int(h * 0.165)

    if densepose_mask is not None:
        dp_l = densepose_mask.convert("L")
        if dp_l.size != (w, h):
            dp_l = dp_l.resize((w, h), Image.NEAREST)
        dp_bytes = dp_l.tobytes()

        face_ids = set(DENSE_INDEX_MAP["face"])
        hand_foot_ids = set(DENSE_INDEX_MAP["hands"] + DENSE_INDEX_MAP["feet"])
        torso_ids = set(DENSE_INDEX_MAP["torso"])

        torso_rows = []
        for idx, d_val in enumerate(dp_bytes):
            if d_val in face_ids or d_val in hand_foot_ids:
                mask_bytes[idx] = 0
            elif d_val in torso_ids:
                torso_rows.append(idx // w)

        if torso_rows and part in ("upper", "overall"):
            torso_top_y = min(torso_rows)
            head_ceiling_y = max(head_ceiling_y, torso_top_y - int(h * 0.015))

    # Zero out all pixels above head_ceiling_y so the faceless mannequin head is strictly preserved
    limit_idx = min(len(mask_bytes), max(0, head_ceiling_y) * w)
    for i in range(limit_idx):
        mask_bytes[i] = 0

    return Image.frombytes("L", (w, h), bytes(mask_bytes))


def verify_mask_torso_and_head_regions(
    mask: Image.Image,
    category: str = "upper_body",
    target_size: Tuple[int, int] = (CANONICAL_WIDTH, CANONICAL_HEIGHT),
) -> Dict[str, Any]:
    """
    Verifies that a 768x1024 agnostic mask:
      1. Matches exact canonical dimensions (768x1024) in grayscale mode 'L'.
      2. Preserves the faceless mannequin head region (top 16% of image height has <= 5% white pixels).
      3. Covers the target anatomical region calibrated to the 3D mannequin front capture
         (head: 0.065H..0.175H, torso: 0.21H..0.46H, lower legs: 0.62H..0.82H).
    """
    part = map_category_to_automasker_part(category)
    validated = validate_mask(mask, target_size=target_size)
    w, h = validated.size
    if (w, h) != target_size:
        raise ValueError(f"Mask dimensions {validated.size} do not match expected {target_size}")

    def _region_white_ratio(box: Tuple[int, int, int, int]) -> float:
        crop = validated.crop(box)
        hist = crop.histogram()
        total = max(1, crop.size[0] * crop.size[1])
        white_pixels = sum(hist[128:])
        return white_pixels / total

    # 1. Head region: top 16% of image height, central 50% width
    head_box = (int(w * 0.25), 0, int(w * 0.75), int(h * 0.16))
    head_ratio = _region_white_ratio(head_box)

    # 2. Torso region: 21% to 46% of image height, central 46% width
    torso_box = (int(w * 0.27), int(h * 0.21), int(w * 0.73), int(h * 0.46))
    torso_ratio = _region_white_ratio(torso_box)

    # 3. Lower-body region: 60% to 82% of image height, central 44% width
    lower_box = (int(w * 0.28), int(h * 0.60), int(w * 0.72), int(h * 0.82))
    lower_ratio = _region_white_ratio(lower_box)

    if head_ratio > 0.05:
        raise ValueError(
            f"Mask validation failed: faceless head region is not preserved (head_inpaint_ratio={head_ratio:.3f} > 0.05)"
        )

    if part in ("upper", "overall") and torso_ratio < 0.15:
        raise ValueError(
            f"Mask validation failed: upper-body torso region has insufficient mask coverage (torso_inpaint_ratio={torso_ratio:.3f} < 0.15)"
        )

    if part == "upper" and lower_ratio > 0.25:
        raise ValueError(
            f"Mask validation failed: upper-body mask bleeds into lower legs (lower_inpaint_ratio={lower_ratio:.3f} > 0.25)"
        )

    if part == "lower":
        if lower_ratio < 0.15:
            raise ValueError(
                f"Mask validation failed: lower-body region has insufficient mask coverage (lower_inpaint_ratio={lower_ratio:.3f} < 0.15)"
            )
        if torso_ratio > 0.25:
            raise ValueError(
                f"Mask validation failed: lower-body mask bleeds into upper torso (torso_inpaint_ratio={torso_ratio:.3f} > 0.25)"
            )

    return {
        "valid": True,
        "width": w,
        "height": h,
        "automasker_part": part,
        "head_inpaint_ratio": round(head_ratio, 4),
        "torso_inpaint_ratio": round(torso_ratio, 4),
        "lower_inpaint_ratio": round(lower_ratio, 4),
    }


def validate_input_payload(payload: Any) -> Tuple[Dict[str, Any], Optional[str]]:
    """
    Validates the RunPod job input dictionary against schema rules.
    Supports both automatic masking (when `mask_image` is omitted/null) and explicit `mask_image`.
    Returns (cleaned_config, error_message).
    """
    if not isinstance(payload, dict):
        return {}, "Input payload must be a JSON object"

    person_image = payload.get("person_image")
    if not person_image or not isinstance(person_image, str) or not person_image.strip():
        return {}, "Missing or invalid 'person_image' (must be a valid URL or base64 string)"

    garment_image = payload.get("garment_image") or payload.get("cloth_image")
    if not garment_image or not isinstance(garment_image, str) or not garment_image.strip():
        return {}, "Missing or invalid 'garment_image' (must be a valid URL or base64 string)"

    raw_category = payload.get("category") or payload.get("cloth_type") or "upper_body"
    if raw_category not in SUPPORTED_CATEGORIES:
        return (
            {},
            f"Invalid 'category': got '{raw_category}'. Must be one of {sorted(SUPPORTED_CATEGORIES)}",
        )
    automasker_part = map_category_to_automasker_part(raw_category)

    # Optional parameters with safe defaults matching official CatVTON Gradio app.py
    try:
        steps = int(payload.get("num_inference_steps", 50))
        if not (10 <= steps <= 100):
            return {}, f"num_inference_steps must be an integer between 10 and 100 (got {steps})"
    except (ValueError, TypeError):
        return {}, "num_inference_steps must be a valid integer"

    try:
        guidance = float(payload.get("guidance_scale", 2.5))
        if not (0.0 <= guidance <= 7.5):
            return {}, f"guidance_scale must be a float between 0.0 and 7.5 (got {guidance})"
    except (ValueError, TypeError):
        return {}, "guidance_scale must be a valid float"

    seed = payload.get("seed", 42)
    if seed is not None:
        try:
            seed = int(seed)
        except (ValueError, TypeError):
            return {}, "seed must be an integer when provided"

    mask_image = payload.get("mask_image")
    if mask_image is not None:
        if not isinstance(mask_image, str) or not mask_image.strip():
            return {}, "mask_image must be a non-empty string when provided"

    masking_strategy = payload.get("masking_strategy")
    if masking_strategy is None:
        masking_strategy = "provided" if mask_image else "auto"
    elif masking_strategy not in ("auto", "provided"):
        return {}, "masking_strategy must be 'auto' or 'provided'"

    repaint = bool(payload.get("repaint", True))

    # Phase 3 realism options (FitSync mannequin)
    sleeve_length = payload.get("sleeve_length", "auto")
    if sleeve_length not in ("auto", "sleeveless", "short_sleeve", "long_sleeve"):
        return {}, "sleeve_length must be one of 'auto', 'sleeveless', 'short_sleeve', 'long_sleeve'"

    mask_refinement = payload.get("mask_refinement", "fitsync")
    if mask_refinement not in ("fitsync", "official"):
        return {}, "mask_refinement must be 'fitsync' or 'official'"

    try:
        hem_extend_ratio = float(payload.get("hem_extend_ratio", 0.04))
        if not (0.0 <= hem_extend_ratio <= 0.15):
            return {}, f"hem_extend_ratio must be between 0.0 and 0.15 (got {hem_extend_ratio})"
    except (ValueError, TypeError):
        return {}, "hem_extend_ratio must be a valid float"

    reframe_person = bool(payload.get("reframe_person", True))
    return_debug_images = bool(payload.get("return_debug_images", False))

    clean_config = {
        "person_image": person_image,
        "garment_image": garment_image,
        "mask_image": mask_image,
        "masking_strategy": masking_strategy,
        "category": raw_category,
        "automasker_part": automasker_part,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "seed": seed,
        "repaint": repaint,
        "sleeve_length": sleeve_length,
        "mask_refinement": mask_refinement,
        "hem_extend_ratio": hem_extend_ratio,
        "reframe_person": reframe_person,
        "return_debug_images": return_debug_images,
    }
    return clean_config, None
