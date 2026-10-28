"""Shared feature code. Every AI task (3 to 7) imports this file."""
from functools import lru_cache

import numpy as np
from PIL import Image

MODEL_NAME = 'patrickjohncyh/fashion-clip'   # if this name has changed, search Hugging Face for Fashion-CLIP


@lru_cache(maxsize=1)
def _load():
    """Loads the model the first time it is needed, so importing this file is fast."""
    import torch
    from transformers import CLIPModel, CLIPProcessor

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    proc = CLIPProcessor.from_pretrained(MODEL_NAME)
    return torch, model, proc, device


def _as_tensor(out, torch):
    # newer versions of transformers may wrap the result in an object
    return out if isinstance(out, torch.Tensor) else out.pooler_output


def embed_images(images):
    """A list of PIL images -> array of shape N x 512 (each row has length 1)."""
    torch, model, proc, device = _load()
    inputs = proc(images=images, return_tensors='pt').to(device)
    with torch.no_grad():
        out = _as_tensor(model.get_image_features(**inputs), torch)
        out = torch.nn.functional.normalize(out, dim=-1)
    return out.cpu().numpy()


def embed_text(texts):
    """A list of strings -> array of shape N x 512, in the same space as the images."""
    torch, model, proc, device = _load()
    inputs = proc(text=texts, return_tensors='pt', padding=True, truncation=True).to(device)
    with torch.no_grad():
        out = _as_tensor(model.get_text_features(**inputs), torch)
        out = torch.nn.functional.normalize(out, dim=-1)
    return out.cpu().numpy()


def color_feat(img):
    """10 numbers describing the colors: an 8-bin hue histogram, mean saturation, mean brightness."""
    hsv = np.asarray(img.convert('RGB').resize((64, 64)).convert('HSV'), dtype=np.float32).reshape(-1, 3) / 255
    h, s, v = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    hist, _ = np.histogram(h, bins=8, range=(0, 1), weights=s)   # which hues, weighted by saturation
    hist = hist / (hist.sum() + 1e-6)
    return np.concatenate([hist, [s.mean(), v.mean()]]).astype(np.float32)


def item_vector(img):
    """One clothing photo -> 522 numbers (512 style + 10 color)."""
    return np.concatenate([embed_images([img])[0], color_feat(img)])
