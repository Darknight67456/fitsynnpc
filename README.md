# FitSync

**FitSync** is a personal-use web app that helps you choose outfits from clothes you already own: catalogue your wardrobe, get occasion-based outfit ideas, mix and match with colour theory, and preview outfits on a 3D mannequin built from your body measurements — no body photo or scan required.

Built by **Group 8** for Workshop 2 (BAXU 3923), Faculty of AI and Cyber Security, UTeM. This is a **non-commercial academic prototype**.

---

## Features

| # | Module | Page | Status |
|---|--------|------|--------|
| 1 | **Digital Wardrobe** — upload clothing photos, background removal, auto-tagging (category, colour, pattern, fabric, season) | `/` | ✅ |
| 2 | **Occasion & Theme Outfits** — complete outfits for an event or theme, plus an AI stylist | `/outfits`, `/stylist` | ✅ |
| 3 | **Colour Theory Mix & Match** — complementary / analogous / triadic / neutral scoring, skin-undertone aware | `/colors` | ✅ |
| 4 | **Outfit Visualization (Virtual Try-On)** — measurement-based 3D mannequin (female / male) in a fitting room, demo clothing catalog, AI try-on photo with CatVTON | `/visualizer`, `/catalog` | ✅ |
| 5 | **Size & Fit Recommendation** | `/size` | 🚧 coming soon |
| 6 | **Wardrobe Insights & Smart Shopping** | `/insights` | 🚧 coming soon |

### Module 4 in short
- **3D fitting room**: a MakeHuman-based mannequin shaped by your height, weight, chest, waist, hips and shoulders. Garments are approximate 3D shapes coloured from the garment photo.
- **Clothes sources**: *My wardrobe* (your Supabase items), *Catalog* (33 team-selected garments: 13 tops, 16 bottoms, 4 outerwear), *Samples* (colour-block placeholders).
- **AI try-on photo**: the front view of the mannequin plus the real garment photo are sent to **CatVTON** on a **RunPod** serverless GPU through a Supabase Edge Function. One garment per photo. It is a visual preview only — it does not prove fit or size.
- **Saved looks**: looks made of wardrobe items are saved to your account; looks that include catalog items are saved on the device.

---

## Architecture

```
Browser (React + Vite, Netlify)
 ├─ Supabase: Auth, Postgres (RLS), Storage (wardrobe-images)
 ├─ FitSync AI service (FastAPI, Google Cloud Run)  ← VITE_AI_URL
 │    /tag /embed /recommend /assist /color-match /color-score /undertone /color-selfie
 └─ Supabase Edge Function "catvton-tryon"           ← AI try-on (Module 4)
        └─ RunPod Serverless GPU: CatVTON + AutoMasker (runpod-worker/)
```

The RunPod API key lives only in Supabase Edge Function secrets. Nothing secret is shipped to the browser.

---

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, React Router, three.js / React Three Fiber / drei
- **Backend**: Supabase (Auth, Postgres with RLS, Storage, Edge Functions)
- **AI service**: Python, FastAPI, Fashion-CLIP, SegFormer clothes segmentation, scikit-learn models (`ai/`)
- **Virtual try-on**: CatVTON (diffusion) + DensePose + SCHP, on RunPod Serverless (`runpod-worker/`)
- **Hosting**: Netlify (frontend), Google Cloud Run (AI service), RunPod (GPU)

---

## Getting started

### Prerequisites
- Node.js **22+** and npm
- A Supabase project (URL + anon key)
- Optional: Python 3.11 for the AI service

### Install and run
```bash
git clone https://github.com/Darknight67456/fitsynnpc.git
cd fitsynnpc
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5173
```

### Environment variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon (public) key |
| `VITE_AI_URL` | for Modules 1–3 AI features | FitSync AI service URL (default `http://localhost:8000`) |
| `VITE_TRYON_MODE` | optional | `mock` (default, no GPU) or `edge_function` (real CatVTON on RunPod) |

> ⚠️ Every `VITE_*` value is visible in the browser. Never put RunPod keys or the Supabase service-role key in `.env`.

### Scripts
| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

---

## Supabase setup

Tables used by the app: `clothing_items`, `outfits`, `body_profiles`, `wear_log`, plus the storage bucket `wardrobe-images`. Each user can only see their own rows (RLS).

Extra SQL to run once in **SQL Editor** (in `supabase/`):
- `add_dress_category.sql`, `add_accessory_types.sql`, `add_occasions.sql`, `wear_log.sql`

**Authentication → URL Configuration**: add your local URL and the Netlify site URL to *Site URL* / *Redirect URLs*, otherwise Google sign-in and email links will not return to the app.

### AI try-on edge function (Module 4)
1. Deploy `supabase/functions/catvton-tryon/index.ts` as an Edge Function named **`catvton-tryon`** (dashboard editor or `supabase functions deploy catvton-tryon`). Keep *Verify JWT* on.
2. Add the secrets (**Edge Functions → Secrets**):
   - `RUNPOD_API_KEY` — your RunPod API key
   - `RUNPOD_ENDPOINT_ID` — the RunPod serverless endpoint ID
3. Set `VITE_TRYON_MODE=edge_function` in the frontend environment.

The function checks the user's session, makes sure wardrobe garments belong to that user, starts a RunPod job and returns a signed job id that the browser polls during cold starts.

---

## RunPod worker (`runpod-worker/`)

CatVTON + AutoMasker (DensePose + SCHP) serverless worker, with FitSync mask refinement for sleeves and mannequin reframing.

- **Build**: from the `Dockerfile` (CUDA 12.1, PyTorch 2.4). RunPod can build it straight from a GitHub repository.
- **Recommended endpoint settings**: previous-generation GPUs only (16–24 GB: A4000, A4500, RTX 4000 Ada, A5000, L4, 3090 — latest-gen GPUs need a CUDA 12.8+ image), active workers **0**, max workers **1**, idle timeout 5 s, execution timeout 600 s, container disk 30 GB, allowed CUDA 12.1+.
- **Test**: send `runpod-worker/test_input.json` from the endpoint's *Requests* tab. The first run downloads the models and takes a few minutes.
- **Local unit tests** (CPU, mocked model): `python -m unittest test_worker` inside `runpod-worker/`.
- **Cost**: billed per second only while a worker runs; roughly a few US cents per try-on photo.

---

## AI service (`ai/`)

FastAPI service used by Modules 1–3.

```bash
cd ai
pip install -r requirements.txt
cd service
uvicorn main:app --reload --port 8000
```

Deployed with the included `Dockerfile` to Google Cloud Run (`gcloud run deploy --source .`). Training notebooks and scripts live in `ai/notebooks`, `ai/deepfashion` and `ai/polyvore`. Dataset sources, licences and citations are recorded in [`ai/DATASETS.md`](ai/DATASETS.md).

---

## Demo clothing catalog

The `/catalog` page reads `public/demo-catalog/catalog.json` (33 garments). It is separate from users' wardrobes and is never written to Supabase.

- Kept garments and their confirmed categories: `scripts/demo_catalog_selection.json`
- Rebuild from the team dataset: `python scripts/build_demo_catalog.py --dataset "Dataset Cloth.zip" --manifest FitSync_Cloth_manifest.json --out public/demo-catalog`
- Trim an existing catalog to the selection: `python scripts/apply_catalog_selection.py --catalog public/demo-catalog --selection scripts/demo_catalog_selection.json --backup <folder>`

Usage rights for catalog photos are tracked per item in **Catalog → Review**; the live GPU path only accepts photos whose rights are confirmed.

---

## 3D mannequin assets

`public/models/fashion-mannequin.glb` (female) and `fashion-mannequin-male.glb` (male) are generated from the CC0 MakeHuman / MPFB2 HM08 base mesh, including the fitted garment meshes and 5 measurement morph targets:

```bash
node scripts/buildMannequinGlb.mjs                          # female
MANNEQUIN_GENDER=male node scripts/buildMannequinGlb.mjs    # male
```

Optional: put a real photo of an empty fitting room at `public/fitting-room/backdrop.jpg` to use it as the 3D viewer background instead of the built-in room.

---

## Deploying to Netlify

`netlify.toml` builds with `npm run build` and publishes `dist/` (single-page-app redirect included).

1. Connect the GitHub repository in Netlify.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_URL` and `VITE_TRYON_MODE` under **Site configuration → Environment variables**.
3. Add the Netlify URL to Supabase **Authentication → URL Configuration**.

> **Private repo on Netlify's free plan:** builds are blocked with *"Unrecognized Git contributor"* when the commit author is not a member of the Netlify team. Merge pull requests from a Netlify team member's GitHub account using **"Create a merge commit"** (not squash or rebase), or upload `dist/` manually under **Deploys**.

---

## Project structure

```
src/
  pages/               Wardrobe, Outfits, Stylist, Colors, Visualizer (fitting room), DemoCatalog, Login…
  modules/
    wardrobe/          upload, photo tools (colour, background removal), wardrobe hooks
    avatar/            3D mannequin, garments, fitting-room scene
    catalog/           demo catalog loading, review, colours
    fittingRoom/       garment picker, device-saved looks
    tryon/             AI try-on panel and service (mock / edge function)
  lib/                 Supabase client, auth actions, AI service client
ai/                    FastAPI AI service, training notebooks and scripts
runpod-worker/         CatVTON serverless worker (Docker)
supabase/              SQL migrations and the catvton-tryon edge function
scripts/               catalog build/trim, mannequin GLB builder
public/                3D models, demo catalog, icons
```

---

## Licences and credits

- **CatVTON** — CC BY-NC-SA 4.0 (non-commercial use only); used here for an academic prototype.
- **MakeHuman / MPFB2** base mesh and targets — CC0.
- **Fashion-CLIP**, **SegFormer**, **DensePose**, **SCHP** — see their own licences.
- Datasets (Polyvore Outfits, DeepFashion, Rent the Runway / ModCloth fit data, ANSUR II) — see [`ai/DATASETS.md`](ai/DATASETS.md) for terms and citations.
- Demo catalog images are for demonstration only; check usage rights before any reuse.

UI inspired at a high level by AI styling apps; no third-party code or design assets were copied.
