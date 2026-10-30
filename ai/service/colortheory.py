"""Module 3: color theory. Which colors go together, a score, and a plain-English reason.

This part is rules from color theory (the color wheel), not a trained model. The AI parts around it are:
the item colors (read from the photo), the skin undertone (read from a selfie), and the learned compatibility
score from the Polyvore model, which is blended in when it is available.
All numbers here are starting points and have not been tuned on user feedback."""
import colorsys
import math

HUE_WARMTH = [(0, 0.3), (40, 1.0), (70, 0.8), (110, 0.1), (170, -0.4), (220, -1.0), (260, -0.7), (330, -0.2), (360, 0.3)]
# base score of a palette by its scheme
SCHEME_BASE = {
    'neutral': 86, 'accent': 90, 'monochromatic': 86, 'analogous': 88, 'complementary': 82,
    'split-complementary': 78, 'triadic': 72, 'contrasting': 68, 'multicolor': 45,
}
SCHEME_REASON = {
    'neutral': 'All neutral colors, so they go with almost anything.',
    'accent': 'One color on a neutral base: simple and hard to get wrong.',
    'monochromatic': 'The same color family in different shades: a calm, tonal look.',
    'analogous': 'Neighboring colors on the color wheel blend smoothly.',
    'complementary': 'Opposite colors on the color wheel make each other stand out.',
    'split-complementary': 'A main color with the two colors beside its opposite: lively but still balanced.',
    'triadic': 'Three evenly spaced colors: playful. It works best when one color dominates.',
    'contrasting': 'Colors a fair distance apart on the wheel: more contrast than neighbors, less harmony than opposites. It works best if one of them is muted.',
    'multicolor': 'Several unrelated bright colors at once. Try keeping one bright color and making the rest neutral.',
}


def _rgb(hex_color):
    h = hex_color.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def valid_hex(value):
    try:
        _rgb(value)
        return isinstance(value, str) and len(value.lstrip('#')) in (3, 6)
    except (ValueError, TypeError, AttributeError):
        return False


def hls(hex_color):
    r, g, b = (v / 255 for v in _rgb(hex_color))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s, l


def is_neutral(hex_color):
    """Black, white, grey, beige/cream/camel/brown and navy count as neutrals in fashion."""
    h, s, l = hls(hex_color)
    if s < 0.14 or l < 0.10 or l > 0.93:
        return True
    if 15 <= h <= 55 and s < 0.55:                    # beige, cream, camel, tan, brown
        return True
    if 195 <= h <= 255 and l < 0.28:                  # navy and very dark blue
        return True
    return False


def hue_gap(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def scheme_of(colors):
    hues = [hls(c)[0] for c in colors if not is_neutral(c)]
    if not hues:
        return 'neutral'
    if len(hues) == 1:
        return 'accent'
    gaps = [hue_gap(a, b) for i, a in enumerate(hues) for b in hues[i + 1:]]
    widest = max(gaps)
    if widest <= 15:
        return 'monochromatic'
    if widest <= 60:
        return 'analogous'
    if len(hues) == 2:
        return 'complementary' if widest >= 150 else 'contrasting'
    if len(hues) == 3 and all(90 <= g <= 150 for g in gaps):
        return 'triadic'
    for h in hues:                                     # one color and two near its opposite
        rest = [x for x in hues if x is not h]
        if rest and all(120 <= hue_gap(h, x) <= 180 for x in rest) and max(hue_gap(rest[0], x) for x in rest) <= 60:
            return 'split-complementary'
    return 'multicolor'


def warmth(hex_color):
    """-1 (cool, blue-based) to +1 (warm, yellow-based). 0 for neutrals."""
    if is_neutral(hex_color):
        return 0.0
    h, s, _ = hls(hex_color)
    for (h0, w0), (h1, w1) in zip(HUE_WARMTH, HUE_WARMTH[1:]):
        if h0 <= h <= h1:
            w = w0 + (w1 - w0) * (h - h0) / (h1 - h0)
            return w * min(1.0, s / 0.6)
    return 0.0


def undertone_fit(hex_color, undertone):
    """-1 to +1: how well a color near the face suits a skin undertone (a common styling guideline, not a rule)."""
    if undertone == 'warm':
        return warmth(hex_color)
    if undertone == 'cool':
        return -warmth(hex_color)
    return 0.0


NEAR_FACE = {'top', 'dress', 'outerwear'}
UNDERTONE_NOTE = {
    True: 'also suits your {u} undertone.',
    False: 'may be less flattering near your face with a {u} undertone.',
}


def score_palette(colors, categories=None, undertone=None):
    """colors: list of hex. categories: same length (optional), used to decide which colors sit near the face."""
    colors = [c for c in colors if valid_hex(c)]
    if not colors:
        return {'score': 0, 'scheme': 'neutral', 'reason': 'No colors to compare.'}
    scheme = scheme_of(colors)
    score = float(SCHEME_BASE[scheme])
    chromatic = [c for c in colors if not is_neutral(c)]
    has_anchor = len(chromatic) < len(colors)
    if chromatic and has_anchor:
        score += 6                                      # a neutral piece calms the colorful ones
    sats = [hls(c)[1] for c in chromatic]
    if len(chromatic) >= 2 and sum(sats) / len(sats) > 0.75:
        score -= 8                                      # two loud colors fight
    reason = SCHEME_REASON[scheme]
    if scheme != 'neutral' and chromatic and has_anchor and scheme not in ('contrasting', 'multicolor'):
        reason += ' A neutral piece keeps it grounded.'

    if undertone in ('warm', 'cool'):
        idx = [i for i, c in enumerate(colors) if (categories is None or (i < len(categories) and categories[i] in NEAR_FACE))]
        fits = [undertone_fit(colors[i], undertone) for i in idx if not is_neutral(colors[i])]
        if fits:
            f = sum(fits) / len(fits)
            score += 8 * f
            if f >= 0.35:
                reason += ' The color near your face ' + UNDERTONE_NOTE[True].format(u=undertone)
            elif f <= -0.35:
                reason += ' The color near your face ' + UNDERTONE_NOTE[False].format(u=undertone)
    return {'score': int(round(max(0, min(100, score)))), 'scheme': scheme, 'reason': reason}


PARTNERS = {
    'top': ['bottom', 'outerwear', 'shoes', 'accessory'],
    'bottom': ['top', 'outerwear', 'shoes', 'accessory'],
    'dress': ['outerwear', 'shoes', 'accessory'],
    'outerwear': ['top', 'bottom', 'dress', 'shoes', 'accessory'],
    'shoes': ['top', 'bottom', 'dress', 'outerwear', 'accessory'],
    'accessory': ['top', 'bottom', 'dress', 'outerwear', 'shoes'],
}


def group_of(item):
    if item.get('category') == 'accessory':
        return item.get('subtype') or 'accessory'
    return item.get('category')


def match(anchor, candidates, undertone=None, per_group=3, style_fn=None):
    """Best color partners for one item, grouped by kind (bottom, shoes, bag...).
    style_fn(a_embedding, b_embedding) -> 0..1 is the learned compatibility score; optional."""
    order = PARTNERS.get(anchor.get('category'), [])
    wanted = set(order)
    groups = {}                                         # group name -> (category, items)
    for c in candidates:
        if c.get('id') == anchor.get('id') or c.get('category') not in wanted or not valid_hex(c.get('color', '')):
            continue
        groups.setdefault(group_of(c), (c['category'], []))[1].append(c)
    out = []
    for key, (category, items) in groups.items():
        rows = []
        for c in items:
            s = score_palette([anchor['color'], c['color']], [anchor.get('category'), c.get('category')], undertone)
            style = None
            if style_fn and anchor.get('embedding') and c.get('embedding'):
                style = float(style_fn(anchor['embedding'], c['embedding']))
            rows.append({'item_id': c['id'], 'color_score': s['score'], 'scheme': s['scheme'], 'reason': s['reason'], '_style': style})
        styles = [r['_style'] for r in rows if r['_style'] is not None]
        lo, hi = (min(styles), max(styles)) if styles else (0, 0)
        for r in rows:
            st = r.pop('_style')
            if st is None:
                r['style_score'], r['score'] = None, r['color_score']
            else:
                norm = (st - lo) / (hi - lo) if hi - lo > 1e-9 else 0.5          # spread within the group so it can rank
                r['style_score'] = int(round(norm * 100))
                r['score'] = int(round(0.65 * r['color_score'] + 0.35 * r['style_score']))
        rows.sort(key=lambda r: -r['score'])
        out.append((order.index(category), {'group': key, 'category': category, 'picks': rows[:per_group]}))
    return [g for _, g in sorted(out, key=lambda t: t[0])]


def check_outfit(items, undertone=None):
    """Score a set of 2 to 5 items together, and name the item that hurts the color harmony most."""
    items = [i for i in items if valid_hex(i.get('color', ''))]
    colors = [i['color'] for i in items]
    cats = [i.get('category') for i in items]
    whole = score_palette(colors, cats, undertone)
    weakest = None
    if len(items) >= 3:
        gains = []
        for k in range(len(items)):
            rest = score_palette(colors[:k] + colors[k + 1:], cats[:k] + cats[k + 1:], undertone)
            gains.append(rest['score'] - whole['score'])
        k = max(range(len(items)), key=lambda x: gains[x])
        if gains[k] >= 6:
            weakest = {'item_id': items[k].get('id'), 'gain_if_removed': int(round(gains[k]))}
    return {**whole, 'weakest': weakest}


# ---------------- skin undertone from a selfie ----------------

def _lab(rgb):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


# hue angle of skin in Lab: lower = pinker/redder (cool), higher = more yellow (warm). Starting thresholds, untuned.
COOL_BELOW, WARM_ABOVE = 52.0, 60.0


def undertone_from_rgb(rgb):
    """rgb: typical skin color (r, g, b). Returns (undertone, confidence 0..1, hue angle)."""
    _, a, b = _lab(rgb)
    hue = math.degrees(math.atan2(b, a))
    if hue <= COOL_BELOW:
        return 'cool', min(1.0, 0.5 + (COOL_BELOW - hue) / 20), hue
    if hue >= WARM_ABOVE:
        return 'warm', min(1.0, 0.5 + (hue - WARM_ABOVE) / 20), hue
    mid = (COOL_BELOW + WARM_ABOVE) / 2
    return 'neutral', max(0.3, 1 - abs(hue - mid) / 4), hue
