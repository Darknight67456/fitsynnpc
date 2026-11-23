"""Module 2: understands ANY free-text request ("friend's wedding, outdoors, no dress, nothing black").

One Gemini (or Claude) call turns the sentence into a small plan the outfit builder can follow.
Everything here is pure Python, so it can be tested without the AI model or a key."""
import colorsys
import json

WEATHERS = ('hot', 'rainy', 'cool', 'all')
STRUCTURES = ('auto', 'dress', 'separates')
OUTERWEAR = ('auto', 'yes', 'no')
ACCESSORY_TYPES = ['bag', 'watch', 'ring', 'necklace', 'earrings', 'bracelet', 'brooch', 'neckwear',
                   'hat', 'hairwear', 'eyewear', 'gloves', 'legwear', 'belt']
COLOR_NAMES = ['black', 'white', 'grey', 'brown', 'beige', 'red', 'orange', 'yellow', 'green',
               'blue', 'navy', 'purple', 'pink']


def color_name(hex_color):
    """'#1f3a93' -> 'navy'. Rough, but good enough for the AI to talk about colours."""
    try:
        h = hex_color.lstrip('#')
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except Exception:
        return 'unknown'
    hue, sat, val = colorsys.rgb_to_hsv(r, g, b)
    hue *= 360
    if val < 0.18:
        return 'black'
    if sat < 0.12:
        return 'white' if val > 0.88 else 'grey'
    if val < 0.5 and 15 <= hue < 50:
        return 'brown'
    if sat < 0.3 and val > 0.7 and 20 <= hue < 60:
        return 'beige'
    if hue < 15 or hue >= 345:
        return 'red' if sat > 0.35 else 'pink'
    if hue < 45:
        return 'orange'
    if hue < 70:
        return 'yellow'
    if hue < 165:
        return 'green'
    if hue < 255:
        return 'navy' if val < 0.6 else 'blue'
    if hue < 295:
        return 'purple'
    return 'pink'


def wardrobe_lines(items):
    """One short line per item for the AI: '3 | top | blue | Oxford shirt'."""
    out = []
    for n, it in enumerate(items):
        kind = it['category'] + (f"/{it['subtype']}" if it.get('subtype') else '')
        out.append(f"{n} | {kind} | {color_name(it.get('color') or '')} | {it.get('name') or 'unnamed'}")
    return out


def build_prompt(event, items):
    return (
        'You are the stylist brain of a wardrobe app. A person typed a free-text request for what to wear. '
        'It can be about ANY occasion, place, weather, mood, body comfort, colour wish or item wish, in any language.\n\n'
        f'Request: "{event}"\n\n'
        'Their wardrobe (index | kind | colour | name):\n' + '\n'.join(wardrobe_lines(items)) + '\n\n'
        'Return ONLY a JSON object with these keys:\n'
        '  "valid": false only if the request has nothing to do with choosing clothes, else true\n'
        '  "formality": 1 loungewear/gym, 2 casual, 3 smart casual, 4 business, 5 formal (whole number)\n'
        '  "weather": "hot" (sunny/outdoor in a tropical country), "rainy", "cool" (cold or air-conditioned), or "all"\n'
        '  "outerwear": "yes" if a jacket/blazer/coat is wanted or needed, "no" if they said no, else "auto"\n'
        '  "structure": "dress" if they want a dress or one-piece, "separates" if they want a top and bottom '
        '(or said no dress), else "auto"\n'
        f'  "accessories": accessory types they want, chosen from {ACCESSORY_TYPES}, [] if none\n'
        '  "must_include": wardrobe indexes they explicitly asked to wear (e.g. "with my navy blazer"), [] if none\n'
        '  "exclude": wardrobe indexes they said not to use, [] if none\n'
        f'  "prefer_colors": colours they want, from {COLOR_NAMES}, [] if none\n'
        f'  "avoid_colors": colours they do not want, from {COLOR_NAMES}, [] if none\n'
        '  "style_text": one short English phrase describing the look that suits the request, like '
        '"elegant pastel outfit for an outdoor daytime wedding" (used to match clothing photos)\n'
        '  "summary": one short friendly English sentence saying how you understood the request\n'
        'Do not invent indexes. Use only what the wardrobe list contains.')


def _ints(values, n):
    out = []
    for v in values or []:
        try:
            k = int(v)
        except (TypeError, ValueError):
            continue
        if 0 <= k < n and k not in out:
            out.append(k)
    return out


def _words(values, allowed):
    out = []
    for v in values or []:
        w = str(v).strip().lower()
        if w in allowed and w not in out:
            out.append(w)
    return out


def normalize_plan(raw, items):
    """Cleans whatever the AI returned so the rest of the code can trust it. Never raises."""
    if not isinstance(raw, dict):
        return None
    n = len(items)
    try:
        formality = int(round(float(raw.get('formality'))))
        formality = formality if 1 <= formality <= 5 else None
    except (TypeError, ValueError):
        formality = None
    weather = str(raw.get('weather', '')).lower()
    outerwear = str(raw.get('outerwear', 'auto')).lower()
    structure = str(raw.get('structure', 'auto')).lower()
    must = _ints(raw.get('must_include'), n)
    exclude = [k for k in _ints(raw.get('exclude'), n) if k not in must]
    return {
        'valid': raw.get('valid', True) is not False,
        'formality': formality,
        'weather': weather if weather in WEATHERS else None,
        'outerwear': outerwear if outerwear in OUTERWEAR else 'auto',
        'structure': structure if structure in STRUCTURES else 'auto',
        'accessories': _words(raw.get('accessories'), ACCESSORY_TYPES),
        'must_include': [items[k]['id'] for k in must],
        'exclude': [items[k]['id'] for k in exclude],
        'prefer_colors': _words(raw.get('prefer_colors'), COLOR_NAMES),
        'avoid_colors': _words(raw.get('avoid_colors'), COLOR_NAMES),
        'style_text': str(raw.get('style_text') or '').strip()[:200],
        'summary': str(raw.get('summary') or '').strip()[:240],
    }


def parse_request(event, items, ask_json):
    """ask_json(prompt) -> text or None. Returns a clean plan dict, or None when the AI is unavailable."""
    text = ask_json(build_prompt(event, items))
    if not text:
        return None
    try:
        text = text.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text
            text = text.rsplit('```', 1)[0]
        return normalize_plan(json.loads(text), items)
    except Exception:
        return None


def adjust_for_colors(items, scores, prefer, avoid):
    """Nudges scores (0 to 1) up for wanted colours and down for unwanted ones."""
    if not prefer and not avoid:
        return scores
    out = dict(scores)
    for it in items:
        name = color_name(it.get('color') or '')
        if name in avoid:
            out[it['id']] -= 0.5
        elif name in prefer:
            out[it['id']] += 0.2
    return out


# ---------------- Module 2b: the Stylist tab (photo + any question) ----------------

STYLIST_KINDS = ['top', 'bottom', 'dress', 'outerwear', 'shoes'] + ACCESSORY_TYPES


def stylist_prompt(question, worn, wardrobe):
    return (
        'You are the stylist brain of a wardrobe app. A person sent a photo and typed a free-text question. '
        'It can be about ANYTHING to do with their outfit: what goes with it, whether it suits an event, '
        'what to change, whether it is too formal, colour advice, or a piece they want to wear. Any language.\n\n'
        f'What the photo shows: {worn}\n'
        f'Their question: "{question}"\n\n'
        'Their wardrobe (index | kind | colour | name):\n' + '\n'.join(wardrobe_lines(wardrobe)) + '\n\n'
        'Return ONLY a JSON object with these keys:\n'
        f'  "targets": kinds of wardrobe item to suggest, chosen from {STYLIST_KINDS}. '
        '"suggest accessories" means several accessory types. Use [] when the question needs only advice, '
        'not wardrobe pieces.\n'
        '  "answer": 1 to 3 short friendly sentences that directly answer the question about the photo outfit '
        '(for example whether it suits the event, or what to change). "" if there is nothing to say beyond suggestions.\n'
        '  "event": a short event or place if they mention one (like "wedding"), else ""\n'
        '  "formality": 1 loungewear, 2 casual, 3 smart casual, 4 business, 5 formal: how formal the finished look '
        'should be, or null if they did not say\n'
        '  "must_include": wardrobe indexes they explicitly want to use, [] if none\n'
        '  "exclude": wardrobe indexes they do not want, [] if none\n'
        f'  "prefer_colors": colours they want, from {COLOR_NAMES}, [] if none\n'
        f'  "avoid_colors": colours they do not want, from {COLOR_NAMES}, [] if none\n'
        '  "style_text": one short English phrase describing the look that suits the request, or ""\n'
        '  "summary": one short English sentence saying how you understood the question\n'
        'Do not invent indexes. Use only what the wardrobe list contains.')


def normalize_stylist_plan(raw, wardrobe):
    """Cleans the AI answer for the stylist. Never raises. Returns None if it is not usable."""
    if not isinstance(raw, dict):
        return None
    base = normalize_plan(raw, wardrobe)
    if base is None:
        return None
    return {
        'targets': _words(raw.get('targets'), STYLIST_KINDS),
        'answer': str(raw.get('answer') or '').strip()[:600],
        'event': str(raw.get('event') or '').strip()[:80],
        'formality': base['formality'],
        'must_include': base['must_include'],
        'exclude': base['exclude'],
        'prefer_colors': base['prefer_colors'],
        'avoid_colors': base['avoid_colors'],
        'style_text': base['style_text'],
        'summary': base['summary'],
    }


def parse_stylist_request(question, worn, wardrobe, ask_json):
    text = ask_json(stylist_prompt(question, worn, wardrobe))
    if not text:
        return None
    try:
        text = text.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text
            text = text.rsplit('```', 1)[0]
        return normalize_stylist_plan(json.loads(text), wardrobe)
    except Exception:
        return None


def rerank(results, plan, n=3):
    """results = [{'target': 'bottom', 'picks': [{'item': item, 'score': 0.7}]}] with more picks than needed.
    Applies the person's wishes (wanted piece first, colours) and keeps the best n."""
    must, prefer, avoid = set(plan['must_include']), plan['prefer_colors'], plan['avoid_colors']
    for r in results:
        for p in r['picks']:
            if p['item']['id'] in must:
                p['score'] += 1.0
            name = color_name(p['item'].get('color') or '')
            if name in avoid:
                p['score'] -= 0.4
            elif name in prefer:
                p['score'] += 0.15
        r['picks'] = sorted(r['picks'], key=lambda p: -p['score'])[:n]
        for p in r['picks']:
            p['score'] = max(0.0, min(1.0, p['score']))
    return results
