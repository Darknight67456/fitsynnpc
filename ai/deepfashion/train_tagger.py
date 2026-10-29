"""Train the FitSync photo tagger on DeepFashion (Category and Attribute Prediction benchmark).

It teaches three small classifiers to read a clothing photo and suggest:
  category (top / bottom / dress / outerwear), pattern, and fabric.
It also measures them against plain Fashion-CLIP guessing (zero-shot), so the report can say how much training helped.

Run it in Google Colab (see 02_deepfashion_tagger.ipynb), or on any computer:
  python train_tagger.py --root "/content/drive/MyDrive/fitsync/data/deepfashion" --out "/content/drive/MyDrive/fitsync/models"

The script is self-contained: it needs only numpy, pillow, scikit-learn, joblib, torch and transformers.
DeepFashion has no shoes or accessories, so those are handled elsewhere (by the clothes detector and Fashion-CLIP).
"""
import argparse
import json
import os
import random
import sys
from collections import Counter

import numpy as np

# ---------------------------------------------------------------- label mapping
# DeepFashion's 50 category names -> the four clothing categories used by FitSync.
CATEGORY_MAP = {
    'top': ['Blouse', 'Button-Down', 'Flannel', 'Halter', 'Henley', 'Hoodie', 'Jersey', 'Sweater', 'Tank', 'Tee',
            'Top', 'Turtleneck'],
    'bottom': ['Capris', 'Chinos', 'Culottes', 'Cutoffs', 'Gauchos', 'Jeans', 'Jeggings', 'Jodhpurs', 'Joggers',
               'Leggings', 'Sarong', 'Shorts', 'Skirt', 'Sweatpants', 'Sweatshorts', 'Trunks'],
    'dress': ['Caftan', 'Coverup', 'Dress', 'Jumpsuit', 'Kaftan', 'Nightdress', 'Onesie', 'Robe', 'Romper',
              'Shirtdress', 'Sundress'],
    'outerwear': ['Anorak', 'Blazer', 'Bomber', 'Cardigan', 'Cape', 'Coat', 'Jacket', 'Kimono', 'Parka', 'Peacoat',
                  'Poncho'],
}
CATEGORY_OF = {name.lower(): ours for ours, names in CATEGORY_MAP.items() for name in names}

# Words found in DeepFashion attribute names -> our pattern and fabric values.
# The script prints which attributes matched each word, so CHECK that list and edit this if something is wrong.
PATTERN_WORDS = {
    'striped': ['stripe'], 'checked': ['plaid', 'check', 'gingham', 'houndstooth'], 'floral': ['floral', 'flower'],
    'polka dot': ['dot', 'polka'], 'graphic print': ['graphic', 'print', 'logo', 'letter', 'animal', 'tribal'],
}
FABRIC_WORDS = {
    'cotton': ['cotton'], 'denim': ['denim'], 'linen': ['linen'], 'silk': ['silk', 'satin'], 'chiffon': ['chiffon'],
    'knit': ['knit'], 'wool': ['wool', 'tweed'], 'leather': ['leather'], 'lace': ['lace'], 'polyester': ['polyester'],
    'nylon': ['nylon'],
}
ATTR_TYPES = {1: 'texture', 2: 'fabric', 3: 'shape', 4: 'part', 5: 'style'}


def find_file(root, name):
    """Find a DeepFashion annotation file anywhere under root."""
    for folder, _, files in os.walk(root):
        if name in files:
            return os.path.join(folder, name)
    raise FileNotFoundError(f'Could not find {name} under {root}. Check the --root folder.')


def read_lines(path):
    """DeepFashion lists start with two header lines (a count, then column names). Skip them."""
    with open(path, encoding='utf-8', errors='ignore') as f:
        lines = f.read().splitlines()
    return [ln for ln in lines[2:] if ln.strip()]


def load_annotations(root):
    cat_names = [ln.rsplit(None, 1)[0] for ln in read_lines(find_file(root, 'list_category_cloth.txt'))]
    cat_of_img = {}
    for ln in read_lines(find_file(root, 'list_category_img.txt')):
        name, label = ln.rsplit(None, 1)
        cat_of_img[name] = int(label) - 1
    attr_names, attr_types = [], []
    for ln in read_lines(find_file(root, 'list_attr_cloth.txt')):
        name, typ = ln.rsplit(None, 1)
        attr_names.append(name.strip().lower())
        attr_types.append(int(typ))
    bbox = {}
    for ln in read_lines(find_file(root, 'list_bbox.txt')):
        p = ln.split()
        bbox[p[0]] = tuple(int(v) for v in p[1:5])
    split = {}
    for ln in read_lines(find_file(root, 'list_eval_partition.txt')):
        name, part = ln.split()
        split[name] = part
    return cat_names, cat_of_img, attr_names, attr_types, bbox, split


def match_attributes(attr_names, words_by_value, wanted_type):
    """Which attribute columns count as each of our pattern / fabric values."""
    out = {}
    for value, words in words_by_value.items():
        cols = [i for i, n in enumerate(attr_names) if any(w in n for w in words)]
        out[value] = cols
    return out


def resolve_img_root(root, sample_name, fake=False):
    """DeepFashion names photos like img/Some_Dress/img_00000001.jpg. Find the folder that makes that path real."""
    if fake:
        return root
    candidates = [root, os.path.join(root, 'Img'), os.path.join(root, 'img'), os.path.join(root, 'Img', 'Img')]
    for c in candidates:
        if os.path.exists(os.path.join(c, sample_name)):
            print(f'Photos found under: {c}')
            return c
    raise SystemExit(f'Could not find {sample_name} under any of: {candidates}\n'
                     'The photos are probably still uploading to Drive, or --img-root is wrong.')


def read_attr_rows(root, wanted_images, n_attrs):
    """Stream the (huge) per-image attribute file and keep only the rows we sampled."""
    wanted = set(wanted_images)
    rows = {}
    with open(find_file(root, 'list_attr_img.txt'), encoding='utf-8', errors='ignore') as f:
        next(f); next(f)
        for ln in f:
            p = ln.split()
            if len(p) >= n_attrs + 1 and p[0] in wanted:
                try:
                    rows[p[0]] = np.array(p[-n_attrs:], dtype=np.int8)
                except ValueError:
                    continue
                if len(rows) == len(wanted):
                    break
    values = Counter(int(v) for r in list(rows.values())[:200] for v in r)
    print(f'Attribute rows read: {len(rows)} of {len(wanted)} photos. Values seen in the first 200 rows: {dict(values)}')
    return rows


def pick_label(row, columns_by_value, priority):
    """The first positive value in priority order, or None when nothing is positive."""
    for value in priority:
        if any(row[c] > 0 for c in columns_by_value[value]):
            return value
    return None


# ---------------------------------------------------------------- embedding (Fashion-CLIP)
MODEL_NAME = 'patrickjohncyh/fashion-clip'


class Embedder:
    def __init__(self, fake=False):
        self.fake = fake
        if fake:
            return
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.torch = torch
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = CLIPModel.from_pretrained(MODEL_NAME).to(self.device).eval()
        self.proc = CLIPProcessor.from_pretrained(MODEL_NAME)

    def _t(self, out):
        return out if isinstance(out, self.torch.Tensor) else out.pooler_output

    def images(self, imgs):
        if self.fake:
            return _fake([np.asarray(i.resize((8, 8))).tobytes() for i in imgs])
        t = self.torch
        inp = self.proc(images=imgs, return_tensors='pt').to(self.device)
        with t.no_grad():
            v = t.nn.functional.normalize(self._t(self.model.get_image_features(**inp)), dim=-1)
        return v.cpu().numpy()

    def texts(self, texts):
        if self.fake:
            return _fake([s.encode() for s in texts])
        t = self.torch
        inp = self.proc(text=texts, return_tensors='pt', padding=True, truncation=True).to(self.device)
        with t.no_grad():
            v = t.nn.functional.normalize(self._t(self.model.get_text_features(**inp)), dim=-1)
        return v.cpu().numpy()


def _fake(blobs):
    """Only for the dry run: deterministic pseudo-embeddings, so the whole script can be tested without a model."""
    out = []
    for b in blobs:
        rng = np.random.default_rng(abs(hash(b)) % (2 ** 32))
        v = rng.normal(size=512)
        out.append(v / np.linalg.norm(v))
    return np.stack(out)


def crop_item(path, box, margin=0.1):
    from PIL import Image
    img = Image.open(path).convert('RGB')
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    return img.crop((max(0, x1 - w * margin), max(0, y1 - h * margin),
                     min(img.width, x2 + w * margin), min(img.height, y2 + h * margin)))


# ---------------------------------------------------------------- main
ZERO_SHOT_PROMPTS = {
    'category': {'top': 'a photo of a shirt, blouse, T-shirt or sweater', 'bottom': 'a photo of trousers, jeans, shorts or a skirt',
                 'dress': 'a photo of a dress or jumpsuit', 'outerwear': 'a photo of a jacket, blazer, coat or cardigan'},
    'pattern': {'plain': 'a photo of a plain solid-color garment', 'striped': 'a photo of a striped garment',
                'checked': 'a photo of a checked or plaid garment', 'floral': 'a photo of a floral garment',
                'polka dot': 'a photo of a polka dot garment', 'graphic print': 'a photo of a garment with a graphic print'},
    'fabric': {v: f'a photo of a {v} garment' for v in FABRIC_WORDS},
}


def softmax_pred(img_vecs, text_vecs, labels):
    return [labels[i] for i in (img_vecs @ text_vecs.T).argmax(axis=1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True, help='folder holding the DeepFashion files (Anno_fine, Eval, Img...)')
    ap.add_argument('--img-root', help='folder that contains the "img" folder (default: found under --root)')
    ap.add_argument('--out', required=True, help='folder to save tagger.joblib and tagger_report.json')
    ap.add_argument('--train', type=int, default=20000)
    ap.add_argument('--test', type=int, default=3000)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--fake', action='store_true', help='dry run with fake embeddings (no model needed)')
    a = ap.parse_args()
    random.seed(a.seed)
    os.makedirs(a.out, exist_ok=True)

    from joblib import dump
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score

    print('Reading annotations...')
    cat_names, cat_of_img, attr_names, attr_types, bbox, split = load_annotations(a.root)

    print('\nAttribute columns matched to each pattern / fabric word (CHECK these look right):')
    pat_cols = match_attributes(attr_names, PATTERN_WORDS, 1)
    fab_cols = match_attributes(attr_names, FABRIC_WORDS, 2)
    for title, cols in (('pattern', pat_cols), ('fabric', fab_cols)):
        for value, idx in cols.items():
            print(f'  {title:8s} {value:14s} <- {[attr_names[i] for i in idx][:8]}')
    pat_cols = {v: c for v, c in pat_cols.items() if c}
    fab_cols = {v: c for v, c in fab_cols.items() if c}

    # keep only images of the four clothing categories that have a box and a split
    usable = [n for n, c in cat_of_img.items()
              if cat_names[c].lower() in CATEGORY_OF and n in bbox and n in split]
    print(f'\n{len(usable)} usable images of {len(cat_of_img)}')
    by_split = {s: [n for n in usable if split[n] == s] for s in ('train', 'val', 'test')}
    for s in by_split:
        random.shuffle(by_split[s])
    chosen = {'train': by_split['train'][:a.train], 'test': (by_split['test'] or by_split['val'])[:a.test]}

    img_root = resolve_img_root(a.img_root or a.root, (chosen['train'] or chosen['test'])[0], a.fake)
    emb = Embedder(a.fake)
    attrs = read_attr_rows(a.root, chosen['train'] + chosen['test'], len(attr_names))

    def embed(names):
        """Embed the photos. Returns the vectors and the names of the photos that could be read."""
        X, kept, batch, meta = [], [], [], []
        def flush():
            if not batch:
                return
            for v, m in zip(emb.images(batch), meta):
                X.append(v); kept.append(m)
            batch.clear(); meta.clear()
        first_error = None
        for k, n in enumerate(names):
            path = os.path.join(img_root, n)
            if a.fake and not os.path.exists(path):
                continue
            try:
                batch.append(crop_item(path, bbox[n]))
            except Exception as e:
                if first_error is None:
                    first_error = f'{path}: {type(e).__name__}: {e}'
                    print('  could not open a photo (skipping, will keep trying):', first_error)
                continue
            meta.append(n)
            if len(batch) == 64:
                flush()
            if k % 2000 == 0:
                print(f'  embedded {k}/{len(names)}')
        flush()
        if not X:
            raise SystemExit(f'No photos could be read. First problem: {first_error}\n'
                             f'Check --img-root. It must be the folder that contains the "img" folder.')
        return np.stack(X), kept

    def cached_embed(tag, names):
        """Embedding is the slow part, so keep the result in the output folder and reuse it on a re-run."""
        os.makedirs(a.out, exist_ok=True)
        cache = os.path.join(a.out, f'emb_cache_{tag}_{len(names)}_{a.seed}.npz')
        if os.path.exists(cache):
            z = np.load(cache, allow_pickle=True)
            print(f'  reusing saved embeddings: {cache}')
            return z['X'], list(z['kept'])
        X, kept = embed(names)
        np.savez(cache, X=X, kept=np.array(kept, dtype=object))
        return X, kept

    def labels(kept):
        ycat, ypat, yfab = [], [], []
        for n in kept:
            row = attrs.get(n)
            pat = pick_label(row, pat_cols, list(pat_cols)) if row is not None else None
            fab = pick_label(row, fab_cols, list(fab_cols)) if row is not None else None
            ycat.append(CATEGORY_OF[cat_names[cat_of_img[n]].lower()])
            ypat.append(pat if pat else 'plain')
            yfab.append(fab)
        return np.array(ycat), np.array(ypat), np.array(yfab, dtype=object)

    print('\nEmbedding training photos (the slow part)...')
    Xtr, ktr = cached_embed('train', chosen['train'])
    print('Embedding test photos...')
    Xte, kte = cached_embed('test', chosen['test'])
    ctr, ptr, ftr = labels(ktr)
    cte, pte, fte = labels(kte)
    print(f'train {len(Xtr)}, test {len(Xte)}')
    print('class counts (train):', 'category', dict(Counter(ctr)), '| pattern', dict(Counter(ptr)),
          '| fabric', dict(Counter(f for f in ftr if f)))

    report, models = {}, {}
    for name, ytr, yte, labels_ok in (('category', ctr, cte, None), ('pattern', ptr, pte, None), ('fabric', ftr, fte, 'fabric')):
        tr = np.array([y is not None and y != 'None' for y in ytr])      # fabric: only photos that name a fabric
        te = np.array([y is not None and y != 'None' for y in yte])
        if tr.sum() < 20 or te.sum() < 5 or len(set(ytr[tr].astype(str))) < 2:
            print(f'Not enough different labels for {name} (need 2 or more kinds); skipped.')
            continue
        clf = LogisticRegression(max_iter=2000, C=2.0, class_weight='balanced')
        clf.fit(Xtr[tr], ytr[tr].astype(str))
        pred = clf.predict(Xte[te])
        truth = yte[te].astype(str)
        entry = {'trained_accuracy': round(float(accuracy_score(truth, pred)), 4),
                 'trained_macro_f1': round(float(f1_score(truth, pred, average='macro')), 4), 'n_test': int(te.sum())}
        prompts = {k: v for k, v in ZERO_SHOT_PROMPTS[name].items() if k in set(ytr[tr].astype(str))}
        if prompts:
            tv = emb.texts(list(prompts.values()))
            zs = softmax_pred(Xte[te], tv, list(prompts))
            entry['zero_shot_accuracy'] = round(float(accuracy_score(truth, zs)), 4)
            entry['zero_shot_macro_f1'] = round(float(f1_score(truth, zs, average='macro')), 4)
        report[name] = entry
        models[name] = clf
        print(f'{name:9s}', entry)

    dump({'models': models, 'meta': {'embedder': MODEL_NAME, 'classes': {k: list(m.classes_) for k, m in models.items()}}},
         os.path.join(a.out, 'tagger.joblib'))
    with open(os.path.join(a.out, 'tagger_report.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(f'\nSaved tagger.joblib and tagger_report.json to {a.out}')


if __name__ == '__main__':
    sys.exit(main())
