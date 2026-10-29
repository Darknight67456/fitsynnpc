"""Compatibility model: how well two clothing items go together.
Trained on Polyvore outfits (ai/polyvore/train_compat.py). Put the file compat.joblib next to this one.
When the file is missing, everything falls back to plain photo similarity, so the service still works."""
import os

import numpy as np

MODEL_PATH = os.getenv('COMPAT_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'compat.joblib'))
_model = None
_tried = False


def _load():
    global _model, _tried
    if not _tried:
        _tried = True
        try:
            from joblib import load
            _model = load(MODEL_PATH)['model']
        except Exception:
            _model = None
    return _model


def available():
    return _load() is not None


def pair_features(a, b):
    """Must match pair_features in ai/polyvore/train_compat.py."""
    return np.concatenate([a * b, np.abs(a - b)], axis=-1)


def pair_score(a, b):
    """0 to 1: how likely the two items belong in one outfit. Plain similarity when no model is loaded."""
    a = np.asarray(a, dtype='float32')
    b = np.asarray(b, dtype='float32')
    model = _load()
    if model is None:
        return float(np.dot(a, b))
    return float(model.predict_proba(pair_features(a, b)[None])[0, 1])
