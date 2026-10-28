"""Module 2 brain: scores wardrobe items for an event and builds outfits.
Pure numpy, so it can be tested without the AI model."""
from itertools import product

import numpy as np

FORMALITY_NAMES = {1: 'loungewear', 2: 'casual', 3: 'smart casual', 4: 'business', 5: 'formal'}
SEASON_NAMES = {'hot': 'hot and sunny', 'rainy': 'rainy', 'cool': 'cool or air-con'}

# Words used for zero-shot understanding of the event (Fashion-CLIP compares them with the event text).
FORMALITY_PROMPTS = [
    'comfortable loungewear, sleepwear or gym sportswear',
    'relaxed casual clothes like a T-shirt and jeans',
    'smart casual clothes like a polo, chinos or a nice blouse',
    'business attire for the office or a job interview',
    'formal attire for a wedding, graduation or ceremony',
]
WEATHER_PROMPTS = {
    'hot': 'light breathable clothes for a hot sunny day outdoors',
    'rainy': 'practical clothes for a rainy day',
    'cool': 'warm layered clothes for a cold air-conditioned place',
    'all': 'clothes for any ordinary day',
}


def _softmax(x, temp=0.02):
    z = (x - x.max()) / temp
    e = np.exp(z)
    return e / e.sum()


def understand_event(text_vec, formality_vecs, weather_vecs):
    """Zero-shot: which formality (1-5) and weather does this event text sound like?"""
    p = _softmax(formality_vecs @ text_vec)
    formality = float((p * np.arange(1, 6)).sum())
    names = list(weather_vecs)
    w = _softmax(np.stack([weather_vecs[n] for n in names]) @ text_vec)
    weather = names[int(w.argmax())]
    return round(formality), weather


def score_items(items, text_vec, formality, weather):
    """Returns {item_id: score between 0 and 1}. Higher = better for this event."""
    scores = {}
    for cat in {i['category'] for i in items}:
        group = [i for i in items if i['category'] == cat]
        fit = np.array([float(np.dot(text_vec, i['embedding'])) for i in group])
        rng = fit.max() - fit.min()
        fit = (fit - fit.min()) / rng if rng > 1e-9 else np.full(len(group), 0.5)
        for it, f in zip(group, fit):
            levels = it.get('formality_levels') or [it['formality']]
            gap = min(abs(l - formality) for l in levels)       # the closest occasion the item suits
            s = f - 0.2 * gap                                   # being far from the right formality costs a lot
            if weather in SEASON_NAMES and it['season'] not in ('all', weather):
                s -= 0.3                                        # wrong weather
            scores[it['id']] = float(s)
    lo, hi = min(scores.values()), max(scores.values())
    return {k: (v - lo) / (hi - lo) if hi > lo else 0.5 for k, v in scores.items()}


def harmony(parts):
    """How well the pieces go together. Starts as embedding similarity.
    Later, replace this ONE function with the trained compatibility model (Task 3)."""
    if len(parts) < 2:
        return 1.0
    sims = [float(np.dot(a['embedding'], b['embedding'])) for k, a in enumerate(parts) for b in parts[k + 1:]]
    return float(np.mean(sims))


def build_outfits(items, scores, weather, top_k=6, n=3):
    """An outfit is shoes + EITHER a dress/one-piece OR a top and a bottom, plus outerwear when cool or rainy."""
    by_cat = {}
    for it in items:
        by_cat.setdefault(it['category'], []).append(it)

    modes = []                                                   # each mode = the slots to fill
    if by_cat.get('top') and by_cat.get('bottom'):
        modes.append(['top', 'bottom'])
    if by_cat.get('dress'):
        modes.append(['dress'])
    missing = []
    if not modes:
        missing.append('a dress, or a top and a bottom')
    if not by_cat.get('shoes'):
        missing.append('shoes')
    if missing:
        return [], missing

    layer = ['outerwear'] if weather in ('cool', 'rainy') and by_cat.get('outerwear') else []
    combos = []
    for mode in modes:
        slots = mode + ['shoes'] + layer
        pools = [sorted(by_cat[s], key=lambda i: -scores[i['id']])[:top_k] for s in slots]
        for parts in product(*pools):
            item_score = float(np.mean([scores[p['id']] for p in parts]))
            fresh = float(np.mean([1 / (1 + p.get('wear_count', 0)) for p in parts]))   # nudges toward clothes you rarely wear
            combos.append({'parts': list(parts), 'item_score': item_score, 'harmony': harmony(parts), 'fresh': fresh})

    h = np.array([c['harmony'] for c in combos])
    rng = h.max() - h.min()
    for c, hn in zip(combos, (h - h.min()) / rng if rng > 1e-9 else np.full(len(h), 0.5)):
        c['score'] = 0.6 * c['item_score'] + 0.3 * float(hn) + 0.1 * c['fresh']

    combos.sort(key=lambda c: -c['score'])
    chosen = []
    for c in combos:                                   # pick the best, then ones that differ in enough pieces
        ids = {p['id'] for p in c['parts']}
        need = 2 if len(ids) >= 3 else 1
        if all(len(ids - {p['id'] for p in o['parts']}) >= need for o in chosen):
            chosen.append(c)
        if len(chosen) == n:
            break
    return chosen, []


def template_reason(c, formality, weather):
    bits = [f"matches a {FORMALITY_NAMES.get(formality, 'casual')} event"]
    if weather in SEASON_NAMES:
        bits.append(f"suits {SEASON_NAMES[weather]} weather")
    if c['fresh'] > 0.5:
        bits.append('uses pieces you have rarely worn')
    return 'This outfit ' + ' and '.join(bits) + '.'
