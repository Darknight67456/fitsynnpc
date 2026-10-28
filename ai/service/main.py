"""FitSync AI service. Run:  uvicorn main:app --reload --port 8000"""
import io
import json
import os

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

import features
import recommend as R

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


def ask_llm(prompt: str, max_tokens: int = 400):
    """Asks whichever AI chat service has a key set. Returns the answer text, or None.
    GEMINI_API_KEY -> Google Gemini (free tier). ANTHROPIC_API_KEY -> Claude. Neither -> None."""
    try:
        if os.getenv('GEMINI_API_KEY'):
            from google import genai
            client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
            res = client.models.generate_content(
                model=os.getenv('GEMINI_MODEL', 'gemini-2.5-flash'), contents=prompt)
            return res.text
        if os.getenv('ANTHROPIC_API_KEY'):
            import anthropic
            msg = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY']).messages.create(
                model=os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-5-5'), max_tokens=max_tokens,
                messages=[{'role': 'user', 'content': prompt}])
            return msg.content[0].text
    except Exception:
        return None
    return None


def parse_json(text):
    """Chat models sometimes wrap JSON in ```json fences. Strip them, then parse."""
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else text
        text = text.rsplit('```', 1)[0]
    return json.loads(text)


def llm_interpret(event: str):
    """Optional: the chat AI reads the event text. Returns (formality, weather) or None."""
    text = ask_llm(
        'Event: ' + event + '\nReturn ONLY JSON like {"formality": 3, "weather": "hot"}. '
        'formality: 1 loungewear, 2 casual, 3 smart casual, 4 business, 5 formal. '
        'weather: hot (sunny/outdoor in Malaysia), rainy, cool (air-con/cold), or all.', 100)
    try:
        data = parse_json(text) if text else None
        w = str(data['weather'])
        return (int(data['formality']), w if w in R.WEATHER_PROMPTS else 'all') if data else None
    except Exception:
        return None


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


@app.post('/recommend')
def recommend(req: Request):
    if not req.event.strip():
        raise HTTPException(400, 'Describe the event first.')
    items = [i.model_dump() for i in req.items]
    for i in items:
        i['embedding'] = np.array(i['embedding'], dtype=np.float32)

    text_vec = features.embed_text([req.event])[0]

    formality, weather = req.formality, req.weather
    if formality is None or weather is None:
        guess = llm_interpret(req.event)
        if guess is None:                                          # no AI chat key: zero-shot with Fashion-CLIP
            fv = features.embed_text(R.FORMALITY_PROMPTS)
            wv = dict(zip(R.WEATHER_PROMPTS, features.embed_text(list(R.WEATHER_PROMPTS.values()))))
            guess = R.understand_event(text_vec, fv, wv)
        formality = formality if formality is not None else guess[0]
        weather = weather if weather is not None else guess[1]
    formality = max(1, min(5, formality))

    scores = R.score_items(items, text_vec, formality, weather)
    chosen, missing, notes = R.build_outfits(items, scores, weather, req.outerwear, req.accessories)
    if missing:
        return {'formality': formality, 'weather': weather, 'outfits': [], 'notes': [],
                'message': 'Add ' + ' and '.join(missing) + ' to your wardrobe to get outfits.'}

    reasons = llm_reasons(req.event, chosen) or [R.template_reason(c, formality, weather) for c in chosen]
    return {'formality': formality, 'weather': weather, 'message': '', 'notes': notes,
            'outfits': [{'item_ids': [p['id'] for p in c['parts']],
                         'score': round(c['score'], 3), 'reason': r}
                        for c, r in zip(chosen, reasons)]}
