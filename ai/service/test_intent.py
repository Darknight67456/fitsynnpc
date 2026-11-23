"""Run:  python test_intent.py   (no AI model or API key needed)"""
import json

import numpy as np

import intent
import recommend as R

rng = np.random.default_rng(0)


def vec():
    v = rng.normal(size=512).astype(np.float32)
    return v / np.linalg.norm(v)


def item(i, cat, color='#808080', sub=None, name=None):
    return {'id': i, 'name': name or i, 'category': cat, 'subtype': sub, 'color': color, 'season': 'all',
            'formality': 3, 'formality_levels': [3], 'wear_count': 0, 'embedding': vec()}


ITEMS = [
    item('t1', 'top', '#101010', name='black tee'), item('t2', 'top', '#ffffff', name='white shirt'),
    item('b1', 'bottom', '#1f3a93', name='navy jeans'), item('b2', 'bottom', '#101010', name='black skirt'),
    item('d1', 'dress', '#e75480', name='pink dress'),
    item('s1', 'shoes', '#ffffff', name='sneakers'),
    item('o1', 'outerwear', '#1f3a93', name='navy blazer'),
    item('a1', 'accessory', '#c0a000', 'watch', 'gold watch'), item('a2', 'accessory', '#303030', 'bag', 'bag'),
]


def fake_ai(reply):
    return lambda prompt: reply if isinstance(reply, str) else json.dumps(reply)


# colour names
assert intent.color_name('#101010') == 'black' and intent.color_name('#ffffff') == 'white'
assert intent.color_name('#e60000') == 'red' and intent.color_name('#1f3a93') == 'navy'

# the AI's answer is cleaned: bad values dropped, indexes turned into ids
p = intent.parse_request('x', ITEMS, fake_ai({
    'valid': True, 'formality': '4', 'weather': 'Sunny', 'outerwear': 'yes', 'structure': 'separates',
    'accessories': ['watch', 'spaceship'], 'must_include': [6, 99, 'a'], 'exclude': [0, 6],
    'avoid_colors': ['Black'], 'style_text': 'smart', 'summary': 'ok'}))
assert p['formality'] == 4 and p['weather'] is None and p['accessories'] == ['watch']
assert p['must_include'] == ['o1'] and p['exclude'] == ['t1'] and p['avoid_colors'] == ['black']

# fenced JSON works, garbage and silence give None
assert intent.parse_request('x', ITEMS, fake_ai('```json\n{"formality": 2}\n```'))['formality'] == 2
assert intent.parse_request('x', ITEMS, fake_ai('not json')) is None
assert intent.parse_request('x', ITEMS, lambda _: None) is None
assert intent.parse_request('x', ITEMS, fake_ai({'valid': False}))['valid'] is False

# colours: avoided colours sink, wanted ones rise
sc = {i['id']: 0.5 for i in ITEMS}
adj = intent.adjust_for_colors(ITEMS, sc, ['pink'], ['black'])
assert adj['t1'] < 0.5 < adj['d1']


def build(**kw):
    scores = {i['id']: 0.5 for i in ITEMS}
    return R.build_outfits(ITEMS, scores, kw.pop('weather', 'hot'), **kw)


def kinds(outfit):
    return {p['category'] for p in outfit['parts']}


chosen, missing, notes = build(structure='dress')
assert chosen and all('dress' in kinds(c) and 'top' not in kinds(c) for c in chosen)
chosen, _, _ = build(structure='separates')
assert chosen and all('top' in kinds(c) and 'dress' not in kinds(c) for c in chosen)

chosen, _, _ = build(must=['o1', 'a1'])                       # "with my navy blazer and gold watch"
assert chosen and all({'o1', 'a1'} <= {p['id'] for p in c['parts']} for c in chosen)

chosen, _, notes = build(must=['d1', 't1'])                   # a dress and a top cannot go together
assert chosen and all('dress' not in kinds(c) for c in chosen) and notes

chosen, _, _ = build(must=['d1'])                             # asking for a dress forces dress outfits
assert chosen and all({'d1', 's1'} <= {p['id'] for p in c['parts']} for c in chosen)

no_dress = [i for i in ITEMS if i['category'] != 'dress']     # wants a dress, has none: still gives outfits + note
chosen, _, notes = R.build_outfits(no_dress, {i['id']: 0.5 for i in no_dress}, 'hot', structure='dress')
assert chosen and any('no dress' in n for n in notes)

chosen, _, _ = build(accessories=['bag'], must=['a1'])        # named watch + extra bag
assert chosen and all({'a1', 'a2'} <= {p['id'] for p in c['parts']} for c in chosen)

# an item that suits two weathers is fine in both, and is marked down in a third
e = vec()
two = [dict(item(k, 'top'), season=sv, embedding=e) for k, sv in (('x1', 'hot,rainy'), ('x2', 'cool'), ('x3', 'all'))]
for w, down in (('hot', 'x2'), ('rainy', 'x2'), ('cool', 'x1')):
    sc = R.score_items(two, e, 3, w)
    assert sc[down] < min(v for k, v in sc.items() if k != down), (w, sc)
print('all intent tests passed')

# ---------------- stylist tab ----------------
worn = 'watch (color #c0a000)'
sp = intent.parse_stylist_request('is this too formal for a hangout? add a bag, nothing black', worn, ITEMS, fake_ai({
    'targets': ['bag', 'laser', 'shoes'], 'answer': 'A bit dressy. Swap to sneakers.', 'event': 'hangout',
    'formality': 2, 'must_include': [6], 'exclude': [3], 'avoid_colors': ['black'], 'prefer_colors': [],
    'style_text': 'relaxed casual', 'summary': 'Checking formality for a hangout.'}))
assert sp['targets'] == ['bag', 'shoes'] and sp['formality'] == 2 and sp['must_include'] == ['o1']
assert sp['exclude'] == ['b2'] and sp['answer'].startswith('A bit') and sp['event'] == 'hangout'
assert intent.parse_stylist_request('x', worn, ITEMS, lambda _: None) is None
assert intent.parse_stylist_request('x', worn, ITEMS, fake_ai('nope')) is None
assert intent.parse_stylist_request('x', worn, ITEMS, fake_ai({'answer': 'Looks great!'}))['targets'] == []

res = [{'target': 'top', 'picks': [{'item': ITEMS[0], 'score': 0.6}, {'item': ITEMS[1], 'score': 0.5}]},
       {'target': 'outerwear', 'picks': [{'item': ITEMS[6], 'score': 0.1}]}]
out = intent.rerank(res, {'must_include': ['o1'], 'prefer_colors': [], 'avoid_colors': ['black']}, n=3)
assert out[0]['picks'][0]['item']['id'] == 't2'                 # the black tee sinks below the white shirt
assert out[1]['picks'][0]['score'] == 1.0                       # the named blazer is pushed to the top and capped

print('all stylist tests passed')
