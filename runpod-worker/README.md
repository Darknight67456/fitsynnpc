# FitSync Module 4 — CatVTON RunPod Serverless Worker (Phase 2: AutoMasker Integrated)

This directory contains the isolated RunPod Serverless worker for **CatVTON** (*CatVTON: Concatenation Is All You Need for Virtual Try-On with Diffusion Models*, ICLR 2025), aligned with the official CatVTON Gradio pipeline (`app.py`, `model/cloth_masker.py`, `model/pipeline.py`, `utils.py`) that was validated in our Google Colab NVIDIA Tesla T4 proof-of-concept.

> [!WARNING]
> **License & Commercial Restriction:**
> CatVTON is licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**.
> It is restricted to non-commercial research, education, and prototyping.

---

## 1. Comparison: Previous Worker vs. Official CatVTON Gradio (`app.py`)

| Pipeline Stage | Previous `runpod-worker` (Phase 1) | Official CatVTON Gradio (`app.py`) & Updated Phase 2 Worker |
| :--- | :--- | :--- |
| **Person Image Normalization** | `resize_and_pad(person, (768, 1024))` | `resize_and_crop(person, (768, 1024))` (center-crops to 3:4 aspect ratio and resizes via `Image.LANCZOS`) |
| **Garment Image Normalization** | `resize_and_pad(garment, (768, 1024))` | `resize_and_padding(garment, (768, 1024))` (aspect-preserving resize centered on `(255, 255, 255)` white RGB canvas) |
| **Category / `cloth_type` Mapping** | Accepted `upper_body`, `lower_body`, `dresses` without mapping to `AutoMasker` | Supports both FitSync (`upper_body`, `lower_body`, `dresses`) and Gradio (`upper`, `lower`, `overall`) via `map_category_to_automasker_part` (`upper_body -> upper`, `lower_body -> lower`, `dresses -> overall`) |
| **Agnostic Mask Generation** | Required explicit `mask_image` (`MaskRequiredError` if omitted) | **Automatic Masking (`AutoMasker`: DensePose + SCHP)** when `mask_image` is omitted (`automasker(person_img, cloth_type)['mask']`), plus regional torso/head verification (`verify_mask_torso_and_head_regions`) |
| **Mask Edge Conditioning** | Hard binary threshold (`0` or `255`) | Official `VaeImageProcessor.blur(mask, blur_factor=9)` before latent concatenation + `repaint_result` compositing so the faceless mannequin head (`y < 0.16H`) is 100% preserved |
| **Docker Build Environment** | `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` (missing `nvcc` & deleted `utils.py`) | `nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04` + `build-essential` + `ninja-build` + `detectron2` + `DensePose` + preserved `model/`, `utils.py`, and `resource/` |

---

## 2. Directory Structure

```
runpod-worker/
├── Dockerfile              # CUDA 12.1.1-devel + Detectron2/DensePose + SCHP + CatVTON + RunPod SDK
├── requirements.txt        # Pinned Python dependencies including scikit-image, PyYAML, ninja, fvcore
├── handler.py              # RunPod Serverless entrypoint with AutoMasker & regional mask verification
├── catvton_pipeline.py     # Singleton loader for CatVTONPipeline + AutoMasker (DensePose + SCHP)
├── preprocessor.py         # resize_and_crop, resize_and_padding, cloth_agnostic_mask, torso/head checks
├── test_input.json         # Sample 768x1024 faceless mannequin + short-sleeve jersey payload ('upper_body')
├── test_worker.py          # Unit test suite (mask dimensions, torso/head preservation, invalid inputs, config)
├── gpu_smoke_test.py       # Documented end-to-end GPU inference test script for >= 8GB VRAM hosts
└── README.md               # Architecture comparison, test documentation, and deployment guide
```

---

## 3. Input & Output Contract (Phase 2)

### Request Payload (`POST /runsync`)
```json
{
  "input": {
    "person_image": "data:image/png;base64,... or https://...",
    "garment_image": "data:image/png;base64,... or https://...",
    "category": "upper_body",
    "masking_strategy": "auto",
    "num_inference_steps": 50,
    "guidance_scale": 2.5,
    "seed": 42,
    "repaint": true
  }
}
```
- `category`: `"upper_body"` | `"lower_body"` | `"dresses"` (or `"upper"` | `"lower"` | `"overall"`).
- `mask_image`: Optional (`null` or omitted uses `AutoMasker` DensePose + SCHP).

### Expected Successful Response
```json
{
  "status": "success",
  "image_base64": "data:image/png;base64,...",
  "mask_base64": "data:image/png;base64,...",
  "category": "upper_body",
  "automasker_part": "upper",
  "masking_strategy": "auto",
  "mask_verification": {
    "valid": true,
    "width": 768,
    "height": 1024,
    "automasker_part": "upper",
    "head_inpaint_ratio": 0.0,
    "torso_inpaint_ratio": 0.9655,
    "lower_inpaint_ratio": 0.0
  },
  "metrics": {
    "preprocessing_ms": 620,
    "inference_ms": 3450,
    "total_ms": 4070,
    "output_resolution": "768x1024",
    "device": "cuda",
    "dtype": "torch.bfloat16"
  }
}
```

---

## 4. Running Unit Tests & Documented GPU Inference Test

### A. CPU Unit Test Suite (No GPU Required)
Validates mask dimensions (`768×1024`), torso-region coverage & faceless-head preservation (`verify_mask_torso_and_head_regions`), invalid image/payload handling, and model loading configuration:
```bash
python runpod-worker/test_worker.py
```

### B. Documented GPU Inference Smoke Test (Requires CUDA GPU with >= 8GB VRAM, e.g., Tesla T4 / L4 / RTX 4090)
Runs one full inference using `test_input.json` (or custom mannequin + "Jersey Padini" images) with automatic masking (`category="upper_body" -> cloth_type="upper"`):
```bash
# Default test using test_input.json (768x1024 faceless mannequin + short-sleeve jersey)
python runpod-worker/gpu_smoke_test.py

# Or with custom exported front-view mannequin & Jersey Padini images:
python runpod-worker/gpu_smoke_test.py \
  --person path/to/captured_mannequin_768x1024.png \
  --garment path/to/jersey_padini.png \
  --category upper_body \
  --steps 50 \
  --guidance 2.5 \
  --seed 42
```
**Expected Output Artifacts:**
1. `runpod-worker/gpu_smoke_mask.png`: Single-channel `768×1024` grayscale mask (`0` black over the faceless mannequin head and legs; `255` white over the upper torso and short-sleeve region).
2. `runpod-worker/gpu_smoke_output.png`: `768×1024` RGB try-on image with the short-sleeve jersey rendered onto the mannequin torso while preserving the faceless head.
3. Terminal JSON summary with `status: "success"`, `masking_strategy: "auto"`, `automasker_part: "upper"`, and `mask_verification.valid: true`.
