"""FitSync AI service. Run:  uvicorn main:app --reload --port 8000"""
import io
import json
import os

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

import colortheory
import compat
import features
import intent
import recommend as R
import stylist
import tagger

app = FastAPI(title='FitSync AI')
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('ALLOW_ORIGINS', '*').split(','),
                   allow_methods=['*'], allow_headers=['*'])


def flatten_on_white(img: Image.Image) -> Image.Image:
    """Cut-out photos have a transparent background. Put them on white before the AI looks at them."""
    img = img.convert('RGBA')
    bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, img).convert('RGB')


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/embed')
async def embed(file: UploadFile = File(...)):
    try:
        img = flatten_on_white(Image.open(io.BytesIO(await file.read())))
    except Exception:
        raise HTTPException(400, 'Could not read that image.')
    return {'embedding': features.embed_images([img])[0].tolist(),
            'color_feat': features.color_feat(img).tolist()}


class Item(BaseModel):
    id: str
    name: str = ''
    category: str
    season: str = 'all'
    formality: int = 2
    subtype: str | None = None                    # accessories only: bag, watch, ring...
    color: str | None = None                      # '#rrggbb', lets the AI understand colour wishes
    formality_levels: list[int] | None = None     # every level the item suits (all 5 = all occasions)
    wear_count: int = 0
    embedding: list[float]


class Request(BaseModel):
    event: str
    items: list[Item]
    formality: int | None = None      # optional: the user picked it
    weather: str | None = None        # optional: 'hot' | 'rainy' | 'cool' | 'all'
    outerwear: str = 'auto'           # 'auto' | 'yes' | 'no'
    accessories: list[str] = []       # accessory types to add: 'bag', 'watch', 'ring', ...


def _ask_gemini(prompt, as_json):
    """Tries the chosen Gemini model, retries when it is busy (503/429), then tries backup models."""
    import time
    from google import genai
    client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
    kwargs = {}
    if as_json:
        from google.genai import types
        kwargs['config'] = types.GenerateContentConfig(response_mime_type='application/json')
    models = [os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite')] + [
        m.strip() for m in os.getenv('GEMINI_FALLBACK_MODELS', 'gemini-3.8-flash,gemini-3.1-flash-lite').split(',') if m.strip()]
    last = None
    for model in dict.fromkeys(models):
        for attempt in range(2):
            try:
                return client.models.generate_content(model=model, contents=prompt, **kwargs).text
            except Exception as e:
                last = e
                text = str(e)
                busy = any(c in text for c in ('503', '429', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED'))
                if busy and attempt == 0:
                    time.sleep(1.5)                      # busy: wait a moment, try the same model once more
                    continue
                break                                    # not found / bad key / still busy: next model
    raise last


LAST_LLM_ERROR = ''


def ask_llm(prompt: str, max_tokens: int = 400, as_json: bool = False):
    """Asks whichever AI chat service has a key set. Returns the answer text, or None.
    GEMINI_API_KEY -> Google Gemini (free tier). ANTHROPIC_API_KEY -> Claude. Neither -> None.
    The reason for a failure is kept in LAST_LLM_ERROR so the website can tell the person."""
    global LAST_LLM_ERROR
    LAST_LLM_ERROR = ''
    try:
        if os.getenv('GEMINI_API_KEY'):
            return _ask_gemini(prompt, as_json)
        if os.getenv('ANTHROPIC_API_KEY'):
            import anthropic
            msg = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY']).messages.create(
                model=os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-5-5'), max_tokens=max(max_tokens, 800),
                messages=[{'role': 'user', 'content': prompt}])
            return msg.content[0].text
        LAST_LLM_ERROR = 'no GEMINI_API_KEY or ANTHROPIC_API_KEY is set on the AI service'
    except Exception as e:
        LAST_LLM_ERROR = f'{type(e).__name__}: {str(e)[:160]}'
        print('ask_llm failed:', LAST_LLM_ERROR, flush=True)
        return None
    return None


def parse_json(text):
    """Chat models sometimes wrap JSON in ```json fences. Strip them, then parse."""
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else text
        text = text.rsplit('```', 1)[0]
    return json.loads(text)


def llm_reasons(event, outfits):
    """Optional: one friendly sentence per outfit. Returns a list of strings or None."""
    lines = [f"{i + 1}. " + ', '.join(p['name'] for p in o['parts']) for i, o in enumerate(outfits)]
    text = ask_llm(
        f'Event: {event}\nOutfits:\n' + '\n'.join(lines) +
        '\nWrite ONE short sentence (max 20 words) per outfit saying why it suits the event. '
        'Return ONLY a JSON list of strings.', 400)
    try:
        out = parse_json(text) if text else None
        return out if out and len(out) == len(outfits) else None
    except Exception:
        return None


def _ask_json(prompt):
    return ask_llm(prompt, 900, as_json=True)


@app.post('/recommend')
def recommend(req: Request):
    if not req.event.strip():
        raise HTTPException(400, 'Describe the event first.')
    items = [i.model_dump() for i in req.items]
    for i in items:
        i['embedding'] = np.array(i['embedding'], dtype=np.float32)

    # 1. The chat AI reads the free-text request and turns it into a plan.
    plan = intent.parse_request(req.event, items, _ask_json) if items else None
    notes = []
    if plan is None:
        reason = LAST_LLM_ERROR or 'the AI chat service did not answer'
        notes.append(f'The AI chat service is not available ({reason}), so a simpler match was used.')
    elif not plan['valid']:
        return {'formality': req.formality or 2, 'weather': req.weather or 'all', 'outfits': [], 'notes': [],
                'message': 'That does not sound like something to dress for. Try an event, place, weather or mood.',
                'understood': plan}

    # 2. What the person picked by hand always wins over what the AI guessed.
    guess_f = plan['formality'] if plan else None
    guess_w = plan['weather'] if plan else None
    formality, weather = req.formality or guess_f, req.weather or guess_w

    # 3. The text the clothing photos are matched against: the request plus the AI's description of the look.
    texts = [req.event] + ([plan['style_text']] if plan and plan['style_text'] else [])
    vecs = features.embed_text(texts)
    text_vec = vecs.mean(axis=0)
    text_vec = text_vec / (np.linalg.norm(text_vec) or 1.0)

    if formality is None or weather is None:                       # no AI chat: zero-shot with Fashion-CLIP
        fv = features.embed_text(R.FORMALITY_PROMPTS)
        wv = dict(zip(R.WEATHER_PROMPTS, features.embed_text(list(R.WEATHER_PROMPTS.values()))))
        zf, zw = R.understand_event(text_vec, fv, wv)
        formality = formality or zf
        weather = weather or zw
    formality = max(1, min(5, int(formality)))

    outerwear = req.outerwear if req.outerwear != 'auto' else (plan['outerwear'] if plan else 'auto')
    accessories = list(dict.fromkeys(list(req.accessories) + (plan['accessories'] if plan else [])))
    skip = set(plan['exclude']) if plan else set()
    pool = [i for i in items if i['id'] not in skip]

    scores = R.score_items(pool, text_vec, formality, weather) if pool else {}
    if plan:
        scores = intent.adjust_for_colors(pool, scores, plan['prefer_colors'], plan['avoid_colors'])
    chosen, missing, more = R.build_outfits(
        pool, scores, weather, outerwear, accessories,
        structure=plan['structure'] if plan else 'auto', must=plan['must_include'] if plan else ())
    notes += more
    understood = plan or {'summary': '', 'valid': True}
    if missing:
        return {'formality': formality, 'weather': weather, 'outfits': [], 'notes': notes, 'understood': understood,
                'message': 'Add ' + ' and '.join(missing) + ' to your wardrobe to get outfits.'}

    reasons = llm_reasons(req.event, chosen) or [R.template_reason(c, formality, weather) for c in chosen]
    return {'formality': formality, 'weather': weather, 'message': '', 'notes': notes, 'understood': understood,
            'outfits': [{'item_ids': [p['id'] for p in c['parts']],
                         'score': round(c['score'], 3), 'reason': r}
                        for c, r in zip(chosen, reasons)]}


# ---------------- Style assistant: selfie + a question ----------------

ACCESSORY_TYPES = ['bag', 'watch', 'ring', 'necklace', 'earrings', 'bracelet', 'brooch', 'neckwear',
                   'hat', 'hairwear', 'eyewear', 'gloves', 'legwear', 'belt']
TARGET_PHRASES = {
    'top': 'a shirt, blouse or T-shirt', 'bottom': 'trousers, jeans or a skirt', 'dress': 'a dress',
    'outerwear': 'a jacket, blazer or coat', 'shoes': 'shoes, sneakers or heels',
    'accessories': 'accessories and jewelry', 'bag': 'a handbag or backpack', 'watch': 'a wrist watch',
    'ring': 'a ring', 'necklace': 'a necklace', 'earrings': 'earrings', 'bracelet': 'a bracelet',
    'brooch': 'a brooch', 'neckwear': 'a scarf, tie or shawl', 'hat': 'a hat or cap',
    'hairwear': 'a hair clip or hair band', 'eyewear': 'glasses or sunglasses', 'gloves': 'gloves',
    'legwear': 'stockings or socks', 'belt': 'a belt',
}


def zero_shot_targets(question, wardrobe):
    """No chat AI: Fashion-CLIP compares the question with a description of each kind of item,
    considering only the kinds the person actually owns."""
    owned_acc = [t for t in ACCESSORY_TYPES if any(i['category'] == 'accessory' and i.get('subtype') == t for i in wardrobe)]
    owned = {i['category'] for i in wardrobe if i['category'] != 'accessory'} | set(owned_acc)
    names = [n for n in TARGET_PHRASES if n in owned or (n == 'accessories' and owned_acc)] or list(TARGET_PHRASES)
    sims = features.embed_text([TARGET_PHRASES[n] for n in names]) @ features.embed_text([question])[0]
    best = names[int(np.argmax(sims))]
    return owned_acc[:4] if best == 'accessories' else [best]


def llm_stylist_reasons(question, worn, results):
    lines = [f"{i + 1}. {r['target']}: " + ', '.join(p['item']['name'] for p in r['picks']) for i, r in enumerate(results)]
    text = ask_llm(
        f'A person wearing {worn} asked: "{question}"\nSuggestions from their wardrobe:\n' + '\n'.join(lines) +
        '\nWrite ONE short friendly sentence (max 22 words) per line explaining why these go with what they wear. '
        'Return ONLY a JSON list of strings.', 500)
    try:
        out = parse_json(text) if text else None
        return out if out and len(out) == len(results) else None
    except Exception:
        return None


@app.post('/assist')
async def assist(photo: UploadFile = File(...), prompt: str = Form(''), items: str = Form('[]')):
    """A photo of a person plus a question -> what they are wearing, and what from their wardrobe goes with it."""
    try:
        img = Image.open(io.BytesIO(await photo.read())).convert('RGB')
        wardrobe = json.loads(items)
    except Exception:
        raise HTTPException(400, 'Could not read the photo or the wardrobe.')
    for i in wardrobe:
        i['embedding'] = np.array(i['embedding'], dtype=np.float32)

    garments, is_person = stylist.analyze(img)
    mode = 'person'
    if not is_person:                                  # a photo of one item: classify the whole picture instead
        one = tagger.single_item(img)
        if one:
            garments, mode = [one], 'item'
    if not garments:
        return {'detected': [], 'targets': [], 'formality': None, 'mode': mode, 'message':
                'I could not see any clothes. Try a clear photo with your whole outfit in view and good light.'}
    for g, v in zip(garments, features.embed_images([g['crop'] for g in garments])):
        g['embedding'] = v
        tagger.refine_garment(g)                      # trained model double-checks top / jacket / dress / accessory type

    fv = features.embed_text(R.FORMALITY_PROMPTS)
    body = [g for g in garments if g['category'] != 'accessory'] or garments
    formality = float(np.mean([R.expected_formality(g['embedding'], fv) for g in body]))

    worn = ', '.join(f"{g['subtype'] or g['category']} (color {g['color']})" for g in garments)
    question = prompt.strip() or 'What goes well with what I am wearing?'
    wardrobe_ok = [i for i in wardrobe]
    plan = intent.parse_stylist_request(question, worn, wardrobe_ok, _ask_json)
    notes = []
    if plan is None:
        reason = LAST_LLM_ERROR or 'the AI chat service did not answer'
        notes.append(f'The AI chat service is not available ({reason}), so a simpler match was used.')
    skip = set(plan['exclude']) if plan else set()
    pool = [i for i in wardrobe if i['id'] not in skip]

    allowed = ['top', 'bottom', 'dress', 'outerwear', 'shoes'] + ACCESSORY_TYPES
    targets = list(plan['targets']) if plan else []
    if plan:                                            # a piece they named is always shown under its own heading
        for i in pool:
            if i['id'] in plan['must_include']:
                t = (i.get('subtype') or 'other') if i['category'] == 'accessory' else i['category']
                if t in allowed and t not in targets:
                    targets.append(t)
    advice_only = bool(plan and plan['answer'] and not targets)
    if not targets and not advice_only:
        targets = zero_shot_targets(question, pool or wardrobe)
    event = plan['event'] if plan else ''
    if plan and plan['formality']:
        formality = float(plan['formality'])            # the person said how formal the look should be
    texts = [t for t in ([event, plan['style_text']] if plan else []) if t.strip()]
    if texts:
        v = features.embed_text(texts).mean(axis=0)
        text_vec = v / (np.linalg.norm(v) or 1.0)
    else:
        text_vec = None

    anchors = [g for g in garments if (g['subtype'] or g['category']) not in targets]
    results = stylist.rank_targets(anchors, targets, pool, text_vec, formality, n=6) if targets else []
    if plan:
        results = intent.rerank(results, plan)
    else:
        for r in results:
            r['picks'] = r['picks'][:3]
    shown = [r for r in results if r['picks']]
    reasons = (llm_stylist_reasons(question, worn, shown) if shown else None) or [
        f"Matches the style and dress code of what you are wearing ({R.FORMALITY_NAMES.get(round(formality), 'casual')})." for _ in shown]
    reason_of = {id(r): why for r, why in zip(shown, reasons)}

    return {
        'formality': round(formality, 1), 'event': event, 'message': '', 'mode': mode, 'notes': notes,
        'answer': plan['answer'] if plan else '', 'understood': {'summary': plan['summary'] if plan else ''},
        'detected': [{'category': g['category'], 'subtype': g['subtype'], 'color': g['color'],
                      'image': stylist.thumbnail_data_uri(g['crop'])} for g in garments],
        'targets': [{'target': r['target'], 'reason': reason_of.get(id(r), ''),
                     'picks': [{'item_id': p['item']['id'], 'score': round(p['score'], 3)} for p in r['picks']]}
                    for r in results],
    }


@app.post('/tag')
async def tag(photo: UploadFile = File(...)):
    """One clothing photo -> suggested tags + its fingerprint. Nothing is saved anywhere."""
    try:
        img = Image.open(io.BytesIO(await photo.read())).convert('RGBA')
    except Exception:
        raise HTTPException(400, 'Could not read that image.')
    img = flatten_on_white(img)
    try:
        garments = stylist.detect_garments(img)
    except Exception as e:                      # the clothes detector failed: look at the whole photo instead
        print('detect_garments failed:', repr(e), flush=True)
        garments = []
    try:
        result = tagger.suggest(img, garments)
    except Exception as e:
        print('tagger.suggest failed:', repr(e), flush=True)
        raise HTTPException(500, f'Tagging failed: {type(e).__name__}')
    result['embedding'] = features.embed_images([img])[0].tolist()      # same as /embed, so the site can find similar items
    return result


# ---------------- Module 3: color theory ----------------

class ColorItem(BaseModel):
    id: str
    color: str
    category: str = ''
    subtype: str | None = None
    embedding: list[float] | None = None


class ColorMatchRequest(BaseModel):
    anchor: ColorItem
    candidates: list[ColorItem]
    undertone: str | None = None
    per_group: int = 3


class ColorCheckRequest(BaseModel):
    items: list[ColorItem]
    undertone: str | None = None


def _undertone(value):
    return value if value in ('warm', 'cool', 'neutral') else None


@app.post('/color-match')
def color_match(req: ColorMatchRequest):
    """One item -> the best color partners from the wardrobe, grouped by kind, each with a score and a reason."""
    style_fn = compat.pair_score if compat.available() else None
    groups = colortheory.match(req.anchor.model_dump(), [c.model_dump() for c in req.candidates],
                               _undertone(req.undertone), max(1, min(req.per_group, 6)), style_fn)
    return {'groups': groups, 'learned_score': style_fn is not None}


@app.post('/color-score')
def color_score(req: ColorCheckRequest):
    """2 to 5 items -> one color score, the scheme, a reason, and the piece that hurts the harmony most."""
    items = [i.model_dump() for i in req.items][:5]
    if len(items) < 2:
        raise HTTPException(400, 'Choose at least 2 items.')
    return colortheory.check_outfit(items, _undertone(req.undertone))


@app.post('/undertone')
async def undertone(photo: UploadFile = File(...)):
    """A selfie -> a guess at skin undertone. Lighting changes it a lot, so the website lets the user correct it."""
    try:
        img = Image.open(io.BytesIO(await photo.read())).convert('RGB')
    except Exception:
        raise HTTPException(400, 'Could not read that image.')
    rgb, part = stylist.skin_color(img)
    if rgb is None:
        return {'undertone': None, 'message': 'I could not find a face or skin in that photo. Try a closer photo in daylight.'}
    kind, confidence, _ = colortheory.undertone_from_rgb(rgb)
    return {'undertone': kind, 'confidence': round(confidence, 2), 'part': part,
            'color': '#%02x%02x%02x' % tuple(int(v) for v in rgb),
            'message': 'Lighting and camera color change this a lot, so check it against how you know your own skin.'}


@app.post('/color-selfie')
async def color_selfie(photo: UploadFile = File(...), undertone: str = Form(''), use_selfie_undertone: bool = Form(True),
                       items: str = Form('[]')):
    """A selfie -> the pieces being worn, the skin undertone, and a color verdict on the outfit with the person."""
    try:
        img = Image.open(io.BytesIO(await photo.read())).convert('RGB')
        wardrobe = json.loads(items)
    except Exception:
        raise HTTPException(400, 'Could not read the photo.')
    info = stylist.analyze_person(img)
    if not info['person'] or not info['garments']:
        return {'message': 'I could not see a person wearing clothes. Use a photo of yourself with your outfit in view, in good light.',
                'pieces': []}

    chosen = _undertone(undertone)
    est = None
    if info['skin_rgb'] is not None:
        kind, conf, _ = colortheory.undertone_from_rgb(info['skin_rgb'])
        est = {'value': kind, 'confidence': round(conf, 2), 'color': '#%02x%02x%02x' % tuple(int(v) for v in info['skin_rgb'])}
    if use_selfie_undertone and est and est['confidence'] >= 0.5:
        used, source = est['value'], 'selfie'
    else:
        used, source = chosen, 'chosen'

    pieces = info['garments']
    check_items = [{'id': str(i), 'color': g['color'], 'category': g['category'], 'subtype': g['subtype']} for i, g in enumerate(pieces)]
    verdict = colortheory.check_outfit(check_items, used)
    weakest, swaps = None, []
    if verdict['weakest']:
        k = int(verdict['weakest']['item_id'])
        weakest = {'index': k, 'gain_if_removed': verdict['weakest']['gain_if_removed']}
        swaps = colortheory.suggest_swaps(check_items, k, wardrobe, used)
    return {
        'message': '', 'score': verdict['score'], 'scheme': verdict['scheme'], 'reason': verdict['reason'],
        'undertone': {'used': used, 'source': source, 'estimate': est},
        'pieces': [{'category': g['category'], 'subtype': g['subtype'], 'color': g['color'],
                    'image': stylist.thumbnail_data_uri(g['crop']),
                    'fit': colortheory.fit_label(g['color'], used) if g['category'] in colortheory.NEAR_FACE else None}
                   for g in pieces],
        'weakest': weakest, 'swaps': swaps,
    }
