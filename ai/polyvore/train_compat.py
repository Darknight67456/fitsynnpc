"""Train the Module 2 compatibility model on Polyvore Outfits.

It learns from real outfits which items go together, using Fashion-CLIP photo fingerprints.
The score is checked with "fill in the blank": given an outfit with one item hidden and 4 candidates,
can the model pick the item that was really in the outfit? Random guessing gets 25%.

Run in Colab (see 03_polyvore_compat.ipynb). Needs: datasets, huggingface_hub, torch, transformers,
scikit-learn, joblib, pillow. You must be logged in to Hugging Face with access to mvasil/polyvore-outfits.

  python train_compat.py --out <folder> [--subset disjoint] [--outfits 3000] [--fitb 600] [--fake]
"""
import argparse
import io
import json
import os
import random
import sys

import numpy as np

REPO = 'mvasil/polyvore-outfits'
MODEL_NAME = 'patrickjohncyh/fashion-clip'


def pair_features(a, b):
    """MUST match ai/service/compat.py. Symmetric, so the order of the two items does not matter."""
    return np.concatenate([a * b, np.abs(a - b)], axis=-1)


# ------------------------------------------------------------------ Fashion-CLIP
class Embedder:
    def __init__(self):
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.t = torch
        self.dev = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = CLIPModel.from_pretrained(MODEL_NAME).to(self.dev).eval()
        self.proc = CLIPProcessor.from_pretrained(MODEL_NAME)

    def images(self, imgs):
        t = self.t
        with t.no_grad():
            inp = self.proc(images=imgs, return_tensors='pt').to(self.dev)
            out = self.model.get_image_features(**inp)
            out = getattr(out, 'pooler_output', out)
            return t.nn.functional.normalize(out, dim=-1).cpu().numpy().astype('float32')


# ------------------------------------------------------------------ data
def hub_json(path):
    from huggingface_hub import hf_hub_download
    with open(hf_hub_download(REPO, path, repo_type='dataset'), encoding='utf-8') as f:
        return json.load(f)


def outfit_items(outfits):
    """set_id -> list of (key like '<set_id>_<index>', item_id)."""
    return {o['set_id']: [(f"{o['set_id']}_{it['index']}", str(it['item_id'])) for it in o['items']] for o in outfits}


def load_real(a):
    rnd = random.Random(a.seed)
    sub = a.subset
    train_sets = outfit_items(hub_json(f'{sub}/train.json'))
    valid_sets = outfit_items(hub_json(f'{sub}/valid.json'))
    ids = sorted(train_sets)
    rnd.shuffle(ids)
    train_sets = {k: train_sets[k] for k in ids[:a.outfits]}

    fitb = hub_json(f'{sub}/fill_in_blank_valid.json')
    rnd.shuffle(fitb)
    fitb = fitb[:a.fitb]
    key_to_item = {k: i for items in valid_sets.values() for k, i in items}

    questions, wanted = [], set(i for items in train_sets.values() for _, i in items)
    wrong_assumption = 0
    for q in fitb:
        keys = q['question']
        try:
            qitems = [key_to_item[k] for k in keys]
            cands = [key_to_item[k] for k in q['answers']]
        except KeyError:
            continue
        set_id, _ = keys[0].rsplit('_', 1)
        right_key = f"{set_id}_{q['blank_position']}"
        if right_key in q['answers']:
            right = q['answers'].index(right_key)
        else:
            right, wrong_assumption = 0, wrong_assumption + 1
        questions.append((qitems, cands, right))
        wanted.update(qitems); wanted.update(cands)
    print(f'{len(train_sets)} training outfits, {len(questions)} fill-in-the-blank questions, {len(wanted)} photos to embed.')
    if wrong_assumption:
        print(f'Note: for {wrong_assumption} questions the right answer was not found by position; assumed the first answer.')

    meta = hub_json('polyvore_item_metadata.json')
    cat = {i: (meta.get(i) or {}).get('semantic_category', 'unknown') for i in wanted}
    return train_sets, questions, wanted, cat


def embed_wanted(a, wanted):
    cache = os.path.join(a.out, f'polyvore_emb_{a.subset}_{a.outfits}_{a.fitb}_{a.seed}.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        print('Reusing saved embeddings:', cache)
        return dict(zip(list(z['ids']), z['X']))
    from datasets import load_dataset
    from PIL import Image
    emb = Embedder()
    out, batch, ids = {}, [], []

    def flush():
        if batch:
            for i, v in zip(ids, emb.images(batch)):
                out[i] = v
            batch.clear(); ids.clear()

    todo = set(wanted)
    for split in ('train', 'validation', 'test'):
        if not todo:
            break
        print(f'Reading {split} photos...')
        ds = load_dataset(REPO, a.subset, split=split, streaming=True)
        for k, row in enumerate(ds):
            iid = str(row['item_id'])
            if iid in todo:
                img = row['image']
                if isinstance(img, dict):
                    img = Image.open(io.BytesIO(img['bytes']))
                batch.append(img.convert('RGB')); ids.append(iid); todo.discard(iid)
                if len(batch) == 64:
                    flush()
                    print(f'  embedded {len(out)}/{len(wanted)}')
            if not todo:
                break
    flush()
    print(f'Embedded {len(out)} of {len(wanted)} photos ({len(todo)} not found).')
    os.makedirs(a.out, exist_ok=True)
    np.savez(cache, ids=np.array(list(out), dtype=object), X=np.stack(list(out.values())))
    return out


def load_fake(a):
    """Synthetic data to test the training code. The numbers it gives mean nothing."""
    rnd = np.random.default_rng(a.seed)
    centers = rnd.normal(size=(8, 512))
    cats = ['tops', 'bottoms', 'shoes', 'bags']
    emb, cat, train_sets, n = {}, {}, {}, 0
    def item(style, c):
        nonlocal n
        n += 1
        v = centers[style] + rnd.normal(scale=1.5, size=512)
        emb[str(n)] = (v / np.linalg.norm(v)).astype('float32'); cat[str(n)] = c
        return str(n)
    for s in range(a.outfits):
        st = int(rnd.integers(8))
        train_sets[str(s)] = [(f'{s}_{k + 1}', item(st, c)) for k, c in enumerate(cats)]
    questions = []
    for _ in range(a.fitb):
        st = int(rnd.integers(8))
        parts = [item(st, c) for c in cats]
        right = parts[-1]
        cands = [right] + [item(int(rnd.integers(8)), cats[-1]) for _ in range(3)]
        order = list(rnd.permutation(4))
        questions.append((parts[:-1], [cands[i] for i in order], order.index(0)))
    return train_sets, questions, emb, cat


# ------------------------------------------------------------------ training and checking
def make_pairs(train_sets, emb, cat, seed):
    rnd = random.Random(seed)
    by_cat = {}
    for items in train_sets.values():
        for _, i in items:
            if i in emb:
                by_cat.setdefault(cat.get(i, 'unknown'), []).append(i)
    all_items = [i for v in by_cat.values() for i in v]
    X, y = [], []
    for items in train_sets.values():
        have = [i for _, i in items if i in emb]
        own = set(have)
        for p in range(len(have)):
            for q in range(p + 1, len(have)):
                a, b = have[p], have[q]
                X.append(pair_features(emb[a], emb[b])); y.append(1)
                pool = by_cat.get(cat.get(b, 'unknown')) or all_items       # same kind of item as b, so the model cannot just learn categories
                for _ in range(5):
                    c = rnd.choice(pool)
                    if c not in own:
                        X.append(pair_features(emb[a], emb[c])); y.append(0)
                        break
    return np.array(X, dtype='float32'), np.array(y)


def fitb_accuracy(questions, emb, scorer):
    right = total = 0
    for qitems, cands, answer in questions:
        qv = [emb[i] for i in qitems if i in emb]
        if not qv or any(c not in emb for c in cands):
            continue
        scores = [np.mean([scorer(q, emb[c]) for q in qv]) for c in cands]
        right += int(int(np.argmax(scores)) == answer); total += 1
    return (right / total if total else float('nan')), total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--subset', default='disjoint', choices=['disjoint', 'nondisjoint'])
    ap.add_argument('--outfits', type=int, default=3000)
    ap.add_argument('--fitb', type=int, default=600)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--fake', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    from joblib import dump
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier

    if a.fake:
        train_sets, questions, emb, cat = load_fake(a)
    else:
        train_sets, questions, wanted, cat = load_real(a)
        emb = embed_wanted(a, wanted)

    X, y = make_pairs(train_sets, emb, cat, a.seed)
    print(f'Training pairs: {len(y)} ({int(y.sum())} real pairs, {int(len(y) - y.sum())} mismatched pairs).')
    if len(set(y)) < 2:
        raise SystemExit('Could not build both matching and mismatched pairs. Not enough photos were embedded.')

    models = {
        'logistic': LogisticRegression(max_iter=2000, C=1.0),
        'mlp': MLPClassifier(hidden_layer_sizes=(256,), early_stopping=True, max_iter=200, random_state=a.seed),
    }
    half = len(questions) // 2
    select_q, report_q = questions[:half], questions[half:]
    cosine = lambda p, q: float(np.dot(p, q))
    results = {'random_guess': 0.25}
    results['plain_similarity'] = round(fitb_accuracy(report_q, emb, cosine)[0], 4)
    best_name, best_acc = None, -1
    for name, clf in models.items():
        clf.fit(X, y)
        scorer = lambda p, q, c=clf: float(c.predict_proba(pair_features(p, q)[None])[0, 1])
        acc, _ = fitb_accuracy(select_q, emb, scorer)
        print(f'{name:9s} fill-in-the-blank on the selection half: {acc:.3f}')
        if acc > best_acc:
            best_name, best_acc = name, acc
    clf = models[best_name]
    scorer = lambda p, q: float(clf.predict_proba(pair_features(p, q)[None])[0, 1])
    final, n = fitb_accuracy(report_q, emb, scorer)
    results.update({'chosen_model': best_name, 'trained_model': round(final, 4), 'n_questions': n,
                    'training_outfits': len(train_sets), 'subset': a.subset})
    print('\nResult on questions the model never trained on or was chosen with:', json.dumps(results, indent=2))

    dump({'model': clf, 'meta': {'embedder': MODEL_NAME, 'name': best_name}}, os.path.join(a.out, 'compat.joblib'))
    with open(os.path.join(a.out, 'compat_report.json'), 'w') as f:
        json.dump(results, f, indent=2)
    print(f'Saved compat.joblib and compat_report.json to {a.out}')


if __name__ == '__main__':
    sys.exit(main())
