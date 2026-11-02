"""Style assistant: finds the clothes a person is wearing in a photo, then ranks the wardrobe against them.
The parts that need the AI models (segment, detect_garments) are separate from the ranking, which is plain numpy."""
import base64
import io
from functools import lru_cache

import numpy as np
from PIL import Image

SEG_MODEL = 'mattmdjaga/segformer_b2_clothes'      # labels each pixel: hat, upper-clothes, pants, shoes...

# model label -> (our category, accessory type)
LABELS = {
    'Upper-clothes': ('top', None), 'Pants': ('bottom', None), 'Skirt': ('bottom', None), 'Dress': ('dress', None),
    'Left-shoe': ('shoes', None), 'Right-shoe': ('shoes', None),
    'Hat': ('accessory', 'hat'), 'Sunglasses': ('accessory', 'eyewear'), 'Bag': ('accessory', 'bag'),
    'Belt': ('accessory', 'belt'), 'Scarf': ('accessory', 'neckwear'),
}
MIN_FRACTION = {'top': 0.02, 'bottom': 0.02, 'dress': 0.03, 'shoes': 0.002, 'accessory': 0.002}   # share of the photo
MAX_SIDE = 768


@lru_cache(maxsize=1)
def _load():
    import torch
    from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor
    proc = SegformerImageProcessor.from_pretrained(SEG_MODEL)
    model = AutoModelForSemanticSegmentation.from_pretrained(SEG_MODEL).eval()
    return torch, proc, model


def segment(img):
    """Returns (class id per pixel, id -> label name)."""
    torch, proc, model = _load()
    inputs = proc(images=img, return_tensors='pt')
    with torch.no_grad():
        logits = model(**inputs).logits
        up = torch.nn.functional.interpolate(logits, size=img.size[::-1], mode='bilinear', align_corners=False)
    return up.argmax(dim=1)[0].numpy(), model.config.id2label


def _to_garment(img, mask, category, subtype):
    """Cut the masked area out of the photo, on a white background, and find its main color."""
    ys, xs = np.where(mask)
    arr = np.asarray(img.convert('RGB'))
    pixels = arr[mask]
    color = '#%02x%02x%02x' % tuple(int(v) for v in np.median(pixels, axis=0))
    out = np.full_like(arr, 255)
    out[mask] = arr[mask]
    crop = Image.fromarray(out).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return {'category': category, 'subtype': subtype, 'color': color, 'crop': crop, 'fraction': float(mask.mean())}


PERSON_LABELS = ('Face', 'Hair', 'Left-arm', 'Right-arm', 'Left-leg', 'Right-leg')
MIN_PERSON_FRACTION = 0.01             # share of the photo that must be face, hair, arms or legs to count as "a person"


def _read(img):
    """One pass of the clothes detector over a photo. Returns (resized photo, garments, person?, skin rgb, skin part)."""
    img = img.convert('RGB')
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    seg, names = segment(img)
    person_ids = [int(i) for i, n in names.items() if n in PERSON_LABELS]
    person = float(np.isin(seg, person_ids).mean()) if person_ids else 0.0
    groups = {}                                        # (category, subtype) -> mask, so left and right shoes join
    for cid, name in names.items():
        if name in LABELS or name.title() in LABELS:             # tolerate small spelling differences in label names
            key = LABELS.get(name) or LABELS[name.title()]
            groups[key] = groups.get(key, np.zeros(seg.shape, bool)) | (seg == int(cid))
    found = []
    for (category, subtype), mask in groups.items():
        if mask.mean() >= MIN_FRACTION[category]:
            found.append(_to_garment(img, mask, category, subtype))
    rgb, part = _skin_from(np.asarray(img), seg, names)
    return img, found, person >= MIN_PERSON_FRACTION, rgb, part


def _skin_from(arr, seg, names):
    """Typical skin color (r, g, b) from the face (or arms when no face is found), and which part was used.
    Dark shadows, bright highlights, lips and eyes are trimmed away."""
    for part, wanted in (('face', ('Face',)), ('arms', ('Left-arm', 'Right-arm'))):
        ids = [int(i) for i, n in names.items() if n in wanted]
        mask = np.isin(seg, ids) if ids else np.zeros(seg.shape, bool)
        if mask.sum() < 200:
            continue
        px = arr[mask].astype(float)
        lum = px @ np.array([0.299, 0.587, 0.114])
        lo, hi = np.percentile(lum, [25, 75])
        keep = px[(lum >= lo) & (lum <= hi)]
        if len(keep):
            return tuple(float(v) for v in np.median(keep, axis=0)), part
    return None, None


def analyze(img):
    """Photo -> (garments found, whether a person is in the photo).
    A photo of one item (a watch on a table, shoes on white) has no person, and the clothes detector is unreliable there."""
    _, found, person, _, _ = _read(img)
    return found, person


def analyze_person(img):
    """Photo of a person -> {'garments', 'person', 'skin_rgb', 'skin_part'} from a single pass of the detector."""
    _, found, person, rgb, part = _read(img)
    return {'garments': found, 'person': person, 'skin_rgb': rgb, 'skin_part': part}


def detect_garments(img):
    """Photo of a person -> list of the garments and accessories found."""
    return analyze(img)[0]


def skin_color(img):
    """Typical skin color (r, g, b) from a selfie. Returns (rgb or None, which part was used)."""
    _, _, _, rgb, part = _read(img)
    return rgb, part


def thumbnail_data_uri(crop, size=160):
    crop = crop.copy()
    crop.thumbnail((size, size))
    buf = io.BytesIO()
    crop.convert('RGB').save(buf, 'JPEG', quality=80)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


# ---------------- ranking (no AI model needed) ----------------

def matches(item, target):
    """target is a category (top, bottom...) or an accessory type (bag, watch...)."""
    if item['category'] == 'accessory':
        return (item.get('subtype') or 'other') == target
    return item['category'] == target


def _norm(x):
    x = np.asarray(x, dtype=float)
    rng = x.max() - x.min()
    return (x - x.min()) / rng if rng > 1e-9 else np.full(len(x), 0.5)


def rank_targets(anchors, targets, items, text_vec, formality, n=3):
    """For each wanted target, the best wardrobe items next to the anchors (the clothes already worn).
    Returns [{'target': 'bottom', 'picks': [{'item': item, 'score': 0.8}]}]."""
    results = []
    for target in targets:
        pool = [i for i in items if matches(i, target)]
        if not pool:
            results.append({'target': target, 'picks': []})
            continue
        if anchors:
            sims = _norm([np.mean([float(np.dot(i['embedding'], a['embedding'])) for a in anchors]) for i in pool])
        else:
            sims = np.full(len(pool), 0.5)
        fit = _norm([float(np.dot(i['embedding'], text_vec)) for i in pool]) if text_vec is not None else None
        gaps = np.array([min(abs(l - formality) for l in (i.get('formality_levels') or [i['formality']])) for i in pool])
        close = 1 - np.minimum(gaps, 3) / 3
        score = 0.55 * sims + 0.25 * fit + 0.2 * close if fit is not None else 0.7 * sims + 0.3 * close
        order = np.argsort(-score)[:n]
        results.append({'target': target, 'picks': [{'item': pool[k], 'score': float(score[k])} for k in order]})
    return results
