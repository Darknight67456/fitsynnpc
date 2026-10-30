"""Reads one clothing photo and SUGGESTS tags (category, color, pattern, fabric, season, occasions).
Nothing is saved: the website fills the form and the user checks it.

How it works:
  1. The clothes detector (SegFormer) finds the garment so the AI looks at the garment, not the background.
  2. Fashion-CLIP turns the garment into a fingerprint.
  3. If a trained model (tagger.joblib, trained on DeepFashion) is present, it decides category, pattern and fabric
     for clothing. If not, Fashion-CLIP compares the fingerprint with written descriptions (zero-shot).
  4. Shoes and accessories are not in DeepFashion. When itemtype.joblib (trained on Polyvore) is present it decides the
     category, including shoes and accessories, and the accessory type; otherwise they use the detector and zero-shot.
"""
import os
from functools import lru_cache

import numpy as np

import features
import recommend as R
import stylist

MODEL_PATH = os.getenv('TAGGER_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tagger.joblib'))
ITEMTYPE_PATH = os.getenv('ITEMTYPE_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'itemtype.joblib'))
MIN_CONFIDENCE = float(os.getenv('TAG_MIN_CONFIDENCE', '0.3'))
MIN_TYPE_CONFIDENCE = float(os.getenv('TAG_MIN_TYPE_CONFIDENCE', '0.45'))

CLOTHING = ['top', 'bottom', 'dress', 'outerwear']
CATEGORY_PROMPTS = {
    'top': 'a photo of a shirt, blouse, T-shirt or sweater', 'bottom': 'a photo of trousers, jeans, shorts or a skirt',
    'dress': 'a photo of a dress or jumpsuit', 'outerwear': 'a photo of a jacket, blazer, coat or cardigan',
    'shoes': 'a photo of shoes, sneakers, heels or sandals', 'accessory': 'a photo of an accessory or jewelry',
}
ACCESSORY_PROMPTS = {
    'bag': 'a handbag or backpack', 'watch': 'a wrist watch', 'ring': 'a ring', 'necklace': 'a necklace',
    'earrings': 'a pair of earrings', 'bracelet': 'a bracelet', 'brooch': 'a brooch', 'neckwear': 'a scarf, tie or shawl',
    'hat': 'a hat or cap', 'hairwear': 'a hair clip or hair band', 'eyewear': 'glasses or sunglasses', 'gloves': 'gloves',
    'legwear': 'stockings or socks', 'belt': 'a belt',
}
# Values must match the options in src/modules/wardrobe/options.ts ("other" and "unknown" are never suggested).
PATTERN_PROMPTS = {
    'plain': 'a plain solid-color', 'striped': 'a striped', 'checked': 'a checked or plaid', 'floral': 'a floral',
    'polka dot': 'a polka dot', 'graphic print': 'a graphic printed', 'batik': 'a batik patterned',
    'two-tone': 'a two-tone', 'glitter': 'a glittery sparkly', 'embellished': 'an embellished', 'printed': 'a printed',
    'studded': 'a studded', 'beaded': 'a beaded',
}
PATTERNS_FOR = {
    'top': ['plain', 'striped', 'checked', 'floral', 'polka dot', 'graphic print', 'batik'],
    'bottom': ['plain', 'striped', 'checked', 'floral', 'polka dot', 'graphic print', 'batik'],
    'dress': ['plain', 'striped', 'checked', 'floral', 'polka dot', 'graphic print', 'batik'],
    'outerwear': ['plain', 'checked', 'striped', 'graphic print'],
    'shoes': ['plain', 'two-tone', 'glitter', 'embellished', 'printed'],
    'accessory': ['plain', 'studded', 'beaded', 'striped', 'floral', 'printed'],
}
FABRIC_PROMPTS = {
    'cotton': 'cotton', 'denim': 'denim', 'linen': 'linen', 'silk': 'silk or satin', 'chiffon': 'chiffon', 'knit': 'knitted',
    'polyester': 'polyester', 'lace': 'lace', 'wool': 'wool', 'leather': 'leather', 'nylon': 'nylon', 'faux leather': 'faux leather',
    'suede': 'suede', 'canvas': 'canvas', 'rubber': 'rubber', 'mesh': 'mesh', 'fabric': 'fabric', 'plastic': 'plastic',
    'metal': 'metal', 'pearl': 'pearl or beads', 'wood': 'wooden', 'glass': 'glass',
}
FABRICS_FOR = {
    'top': ['cotton', 'linen', 'silk', 'chiffon', 'knit', 'polyester', 'denim', 'lace'],
    'bottom': ['cotton', 'denim', 'linen', 'polyester', 'knit', 'silk', 'leather'],
    'dress': ['cotton', 'chiffon', 'silk', 'lace', 'polyester', 'linen', 'knit'],
    'outerwear': ['denim', 'wool', 'leather', 'cotton', 'polyester', 'nylon', 'knit'],
    'shoes': ['leather', 'faux leather', 'suede', 'canvas', 'rubber', 'mesh', 'fabric', 'plastic'],
    'accessory': ['metal', 'leather', 'fabric', 'silk', 'pearl', 'plastic', 'wood', 'canvas', 'glass'],
}
SEASON_PROMPTS = {
    'hot': 'light breathable clothing for hot sunny weather', 'rainy': 'practical water-resistant clothing for rainy weather',
    'cool': 'warm layered clothing for a cold air-conditioned place', 'all': 'plain everyday clothing for any weather',
}


@lru_cache(maxsize=1)
def trained_model():
    """The DeepFashion-trained classifiers, or None when tagger.joblib is not there."""
    if not os.path.exists(MODEL_PATH):
        return None
    try:
        import joblib
        return joblib.load(MODEL_PATH)['models']
    except Exception:
        return None


@lru_cache(maxsize=1)
def itemtype_model():
    """The Polyvore-trained 'what kind of item' classifiers (category incl. shoes/accessories, accessory type), or None."""
    if not os.path.exists(ITEMTYPE_PATH):
        return None
    try:
        import joblib
        return joblib.load(ITEMTYPE_PATH)['models']
    except Exception:
        return None


def _itemtype_choice(name, vec):
    models = itemtype_model()
    if not models or name not in models:
        return None
    clf = models[name]
    proba = clf.predict_proba(vec.reshape(1, -1))[0]
    k = int(np.argmax(proba))
    return str(clf.classes_[k]), float(proba[k])


@lru_cache(maxsize=64)
def _text_vecs(texts):
    return features.embed_text(list(texts))


def zero_shot(vec, prompts, template='a photo of {}'):
    """Compare a fingerprint with written descriptions -> (best label, confidence 0 to 1)."""
    labels = list(prompts)
    tv = _text_vecs(tuple(template.format(prompts[k]) for k in labels))
    p = _softmax(tv @ vec)
    k = int(np.argmax(p))
    return labels[k], float(p[k])


def _softmax(x, temp=0.02):
    z = (x - x.max()) / temp
    e = np.exp(z)
    return e / e.sum()


def _trained_choice(name, vec, allowed):
    """Best class from a trained classifier, restricted to values that exist for this category."""
    models = trained_model()
    if not models or name not in models:
        return None
    clf = models[name]
    proba = clf.predict_proba(vec.reshape(1, -1))[0]
    pairs = [(c, float(p)) for c, p in zip(clf.classes_, proba) if allowed is None or c in allowed]
    if not pairs:
        return None
    total = sum(p for _, p in pairs) or 1.0
    best = max(pairs, key=lambda cp: cp[1])
    return str(best[0]), best[1] / total


def pick_main_garment(garments):
    """The piece to describe: the biggest clothing piece in the photo, else the biggest anything."""
    usable = [g for g in garments if g['fraction'] >= 0.1]
    clothing = [g for g in usable if g['category'] in CLOTHING]
    pool = clothing or usable
    return max(pool, key=lambda g: g['fraction']) if pool else None


def suggest(img, garments):
    """img: PIL photo. garments: output of stylist.detect_garments(img) (may be empty)."""
    from PIL import Image
    main = pick_main_garment(garments)
    look = main['crop'] if main else img.convert('RGB')
    vec = features.embed_images([look])[0]
    out = {'source': 'detected piece' if main else 'whole photo', 'fields': {}, 'confidence': {}}

    def put(field, value, conf):
        if value is not None and conf >= MIN_CONFIDENCE:
            out['fields'][field] = value
            out['confidence'][field] = round(conf, 2)

    # category (and accessory type)
    typed = _itemtype_choice('category', vec)                    # trained on Polyvore: knows shoes and accessories too
    if typed and typed[1] >= MIN_TYPE_CONFIDENCE:
        category, conf = typed
        subtype = None
        if category == 'accessory':
            sub = _itemtype_choice('accessory_type', vec)
            if sub and sub[1] >= MIN_TYPE_CONFIDENCE:
                subtype = sub[0]
        elif category in CLOTHING:
            tr = _trained_choice('category', vec, set(CLOTHING))     # DeepFashion model refines the four clothing kinds
            if tr:
                category, conf = tr
    elif main and main['category'] in ('shoes', 'accessory'):
        category, conf = main['category'], 0.9
        subtype = main['subtype']
    else:
        category, conf = zero_shot(vec, CATEGORY_PROMPTS)
        subtype = None
        if main and main['category'] in CLOTHING:
            category = main['category'] if category not in CLOTHING else category
        if category in CLOTHING:
            tr = _trained_choice('category', vec, set(CLOTHING))
            if tr:
                category, conf = tr
    if category == 'accessory' and not subtype:
        subtype, _ = zero_shot(vec, ACCESSORY_PROMPTS, 'a photo of {}')
    put('category', category, conf)
    if category == 'accessory':
        out['fields']['subtype'] = subtype

    # pattern and fabric: trained model for clothing, zero-shot otherwise
    pats, fabs = PATTERNS_FOR[category], FABRICS_FOR[category]
    noun = {'top': 'garment', 'bottom': 'garment', 'dress': 'dress', 'outerwear': 'jacket', 'shoes': 'pair of shoes',
            'accessory': 'accessory'}[category]
    pat = (_trained_choice('pattern', vec, set(pats)) if category in CLOTHING else None) \
        or zero_shot(vec, {k: PATTERN_PROMPTS[k] for k in pats}, f'a photo of {{}} {noun}')
    fab = (_trained_choice('fabric', vec, set(fabs)) if category in CLOTHING else None) \
        or zero_shot(vec, {k: FABRIC_PROMPTS[k] for k in fabs}, f'a photo of a {noun} made of {{}}')
    put('pattern', *pat)
    put('fabric', *fab)

    # season and occasion (always zero-shot: DeepFashion has neither)
    season, sconf = zero_shot(vec, SEASON_PROMPTS, 'a photo of {}')
    put('season', season, sconf)
    fv = features.embed_text(R.FORMALITY_PROMPTS)
    level = int(min(5, max(1, round(R.expected_formality(vec, fv)))))
    out['fields']['formality_levels'] = [level]
    out['confidence']['formality_levels'] = 0.5

    if main:
        out['fields']['color'] = main['color']
    out['trained'] = bool(trained_model() or itemtype_model())
    return out
