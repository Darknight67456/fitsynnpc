"""Train the "what kind of item is this" model on Polyvore product photos: top, bottom, dress, outerwear,
shoes, accessory, and which accessory (bag, watch, ring...). It fixes the weak spot of the DeepFashion
tagger, which has no shoes or accessories.

It REUSES the photo fingerprints that train_compat.py already saved in --out (polyvore_emb_*.npz), so it needs
no photos and no GPU for training. Run train_compat.py first.

  python train_itemtypes.py --out <folder with polyvore_emb_*.npz> [--fake]
"""
import argparse
import csv
import glob
import json
import os
import re
import sys
from collections import Counter

import numpy as np

REPO = 'mvasil/polyvore-outfits'
MODEL_NAME = 'patrickjohncyh/fashion-clip'
MIN_PER_SUBTYPE = 40
CAP_PER_CLASS = 1500

# order matters: the first rule that matches wins
SUBTYPE_RULES = [
    ('earrings', r'earring'), ('bracelet', r'bracelet|bangle|cuff'), ('necklace', r'necklace|pendant|choker'),
    ('ring', r'\brings?\b'), ('watch', r'watch'), ('brooch', r'brooch'), ('belt', r'\bbelts?\b'),
    ('bag', r'\bbags?\b|handbag|backpack|tote|clutch|satchel|purse'),
    ('eyewear', r'sunglass|glasses|eyewear'), ('gloves', r'glove|mitten'),
    ('neckwear', r'scarf|scarves|\bties?\b|bow tie|shawl|bandana'),
    ('hat', r'\bhats?\b|\bcaps?\b|beanie|beret|fedora'),
    ('hairwear', r'hair|headband|barrette|scrunchie|tiara|headpiece'),
    ('legwear', r'tights|stocking|\bsocks?\b|hosiery'),
]
# What the service does today (zero-shot), copied from tagger.py so the report can show before and after.
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


def our_category(sem):
    s = (sem or '').lower()
    if ('all' in s and 'body' in s) or 'dress' in s:
        return 'dress'
    for word, cat in (('outer', 'outerwear'), ('shoe', 'shoes'), ('top', 'top'), ('bottom', 'bottom')):
        if word in s:
            return cat
    if any(w in s for w in ('bag', 'accessor', 'jewel', 'scarf', 'scarves', 'hat', 'sunglass')):
        return 'accessory'
    return None


def our_subtype(name, title):
    for text in (name, title):                      # the clean category name first, the noisy title only if needed
        t = (text or '').lower()
        for sub, pat in SUBTYPE_RULES:
            if re.search(pat, t):
                return sub
    return None


def load_category_names():
    """categories.csv -> {category_id: name}. Prints its first rows because the layout is not documented."""
    from huggingface_hub import hf_hub_download
    path = hf_hub_download(REPO, 'categories.csv', repo_type='dataset')
    with open(path, encoding='utf-8', errors='ignore') as f:
        rows = list(csv.reader(f))
    print('categories.csv first rows:', rows[:4])
    names = {}
    for r in rows:
        if len(r) >= 2:
            names[r[0].strip()] = ' '.join(r[1:]).strip()
    return names


def load_real(a):
    from huggingface_hub import hf_hub_download
    cache = glob.glob(os.path.join(a.out, 'polyvore_emb_*.npz'))
    if not cache:
        raise SystemExit(f'No polyvore_emb_*.npz in {a.out}. Run train_compat.py first (it saves the photo fingerprints).')
    emb = {}
    for c in cache:
        z = np.load(c, allow_pickle=True)
        emb.update(zip([str(i) for i in z['ids']], z['X']))
    print(f'Loaded {len(emb)} saved photo fingerprints from {len(cache)} file(s).')
    with open(hf_hub_download(REPO, 'polyvore_item_metadata.json', repo_type='dataset'), encoding='utf-8') as f:
        meta = json.load(f)
    names = load_category_names()
    return emb, meta, names


def load_fake(a):
    rng = np.random.default_rng(a.seed)
    cats = [('tops', 'T-Shirts'), ('bottoms', 'Jeans'), ('all-body', 'Dresses'), ('outerwear', 'Coats'), ('shoes', 'Sandals'),
            ('bags', 'Handbags'), ('jewellery', 'Rings'), ('jewellery', 'Watches'), ('hats', 'Beanies')]
    centers = rng.normal(size=(len(cats), 512))
    emb, meta, names = {}, {}, {}
    for k, (sem, nm) in enumerate(cats):
        names[str(k)] = nm
    for n in range(4000):
        k = n % len(cats)
        v = centers[k] + rng.normal(scale=1.0, size=512)
        emb[str(n)] = (v / np.linalg.norm(v)).astype('float32')
        meta[str(n)] = {'semantic_category': cats[k][0], 'category_id': str(k), 'title': 'item ' + str(n)}
    return emb, meta, names


class TextEmbedder:
    def __init__(self):
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.t = torch
        self.dev = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = CLIPModel.from_pretrained(MODEL_NAME).to(self.dev).eval()
        self.proc = CLIPProcessor.from_pretrained(MODEL_NAME)

    def texts(self, texts):
        t = self.t
        with t.no_grad():
            inp = self.proc(text=texts, return_tensors='pt', padding=True, truncation=True).to(self.dev)
            out = self.model.get_text_features(**inp)
            out = getattr(out, 'pooler_output', out)
            return t.nn.functional.normalize(out, dim=-1).cpu().numpy().astype('float32')


def zero_shot_predict(X, prompts, text_embedder):
    labels = list(prompts)
    tv = text_embedder.texts([f'a photo of {prompts[k]}' for k in labels])      # same wording the service uses today
    return np.array(labels)[np.argmax(X @ tv.T, axis=1)]


def per_class(truth, pred):
    return {c: round(float(np.mean(pred[truth == c] == c)), 3) for c in sorted(set(truth))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--fake', action='store_true')
    a = ap.parse_args()
    from joblib import dump
    from sklearn.linear_model import LogisticRegression

    emb, meta, names = load_fake(a) if a.fake else load_real(a)
    rng = np.random.default_rng(a.seed)

    sem_counts = Counter((meta.get(i) or {}).get('semantic_category') for i in emb)
    print('\nPolyvore groups found among the fingerprints and what they map to:')
    for sem, n in sem_counts.most_common():
        print(f'  {str(sem):16s} {n:6d}  ->  {our_category(sem)}')

    rows = []
    for i, v in emb.items():
        m = meta.get(i) or {}
        cat = our_category(m.get('semantic_category'))
        if not cat:
            continue
        sub = our_subtype(names.get(str(m.get('category_id', m.get('catgeory_id', '')))), m.get('title') or m.get('url_name')) \
            if cat == 'accessory' else None
        rows.append((i, cat, sub))
    order = rng.permutation(len(rows))
    rows = [rows[k] for k in order]

    def capped(label_of, keep=None):
        seen, out = Counter(), []
        for r in rows:
            lab = label_of(r)
            if lab is None or (keep and lab not in keep):
                continue
            if seen[lab] < CAP_PER_CLASS:
                seen[lab] += 1; out.append((r[0], lab))
        return out

    def fit_and_check(name, data, prompts, text_embedder):
        ids = [d[0] for d in data]
        X = np.stack([emb[i] for i in ids]); y = np.array([d[1] for d in data])
        n_test = max(1, int(0.2 * len(y)))
        Xte, yte, Xtr, ytr = X[:n_test], y[:n_test], X[n_test:], y[n_test:]
        print(f'\n{name}: {len(ytr)} training photos, {len(yte)} test photos, classes {dict(Counter(ytr))}')
        clf = LogisticRegression(max_iter=3000, C=2.0, class_weight='balanced').fit(Xtr, ytr)
        pred = clf.predict(Xte)
        entry = {'trained_accuracy': round(float(np.mean(pred == yte)), 4), 'per_class': per_class(yte, pred), 'n_test': len(yte)}
        if text_embedder is not None:
            zs = zero_shot_predict(Xte, {k: v for k, v in prompts.items() if k in set(ytr)}, text_embedder)
            entry['current_guessing_accuracy'] = round(float(np.mean(zs == yte)), 4)
        print(name, json.dumps(entry, indent=1))
        return clf, entry

    te = None if a.fake else TextEmbedder()
    cat_data = capped(lambda r: r[1])
    sub_counts = Counter(r[2] for r in rows if r[2])
    print('\nAccessory types found:', dict(sub_counts))
    keep = {s for s, n in sub_counts.items() if n >= MIN_PER_SUBTYPE}
    sub_data = capped(lambda r: r[2], keep)
    if len(set(c for _, c in cat_data)) < 2:
        raise SystemExit('Fewer than 2 item categories were found. Check the "map to" table above.')

    models, report = {}, {}
    models['category'], report['category'] = fit_and_check('category', cat_data, CATEGORY_PROMPTS, te)
    if len(keep) >= 2:
        models['accessory_type'], report['accessory_type'] = fit_and_check('accessory_type', sub_data, ACCESSORY_PROMPTS, te)
    else:
        print('Too few labelled accessories; accessory_type skipped. Check the "Accessory types found" line above.')

    dump({'models': models, 'meta': {'embedder': MODEL_NAME, 'source': 'polyvore'}}, os.path.join(a.out, 'itemtype.joblib'))
    with open(os.path.join(a.out, 'itemtype_report.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(f'\nSaved itemtype.joblib and itemtype_report.json to {a.out}')


if __name__ == '__main__':
    sys.exit(main())
