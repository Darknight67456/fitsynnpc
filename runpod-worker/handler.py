"""
FitSync Module 4 — RunPod Serverless Handler for CatVTON (Phase 2: AutoMasker Enabled)
Matches the official CatVTON Gradio `app.py` preprocessing and inference pipeline:
  1. `resize_and_crop` (768x1024) for `person_image`
  2. `resize_and_padding` (768x1024) for `garment_image`
  3. Automatic masking via `AutoMasker` (DensePose + SCHP) when `mask_image` is omitted,
     or explicit `mask_image` validation when supplied
  4. Torso-region & faceless-head preservation verification
  5. `VaeImageProcessor.blur(mask, blur_factor=9)` + `CatVTONPipeline` diffusion + `repaint_result`
"""

import sys
import time
from typing import Any, Dict

try:
    import runpod
except ImportError:
    runpod = None

from preprocessor import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    decode_image,
    encode_image_to_base64,
    resize_and_crop,
    resize_and_padding,
    sanitize_log_dict,
    validate_input_payload,
    validate_mask,
    verify_mask_torso_and_head_regions,
)
from catvton_pipeline import CatVTONInferenceWrapper
from fitsync_mask import reframe_mannequin_capture

# Singleton pipeline wrapper cached across warm serverless invocations
pipeline_wrapper: Any = None


def get_pipeline() -> CatVTONInferenceWrapper:
    """Lazily loads and caches the CatVTON + AutoMasker pipeline instance."""
    global pipeline_wrapper
    if pipeline_wrapper is None:
        pipeline_wrapper = CatVTONInferenceWrapper.get_instance()
    return pipeline_wrapper


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main RunPod Serverless handler invoked for each request.

    Input schema:
    {
        "input": {
            "person_image": "<URL or base64 data string>",
            "garment_image": "<URL or base64 data string>",
            "category": "upper_body" | "lower_body" | "dresses" | "upper" | "lower" | "overall",
            "masking_strategy": "auto" | "provided", // default: "auto" when mask_image is omitted
            "mask_image": "<Optional URL or base64 data string>",
            "num_inference_steps": 50, // 10-100 (default: 50 matching official app.py)
            "guidance_scale": 2.5,     // 0.0-7.5 (default: 2.5)
            "seed": 42,                // optional deterministic RNG seed
            "repaint": true            // optional composite outside mask (default: true)
        }
    }
    """
    t_start = time.time()
    job_id = job.get("id", "local_job") if isinstance(job, dict) else "local_job"
    raw_input = job.get("input", {}) if isinstance(job, dict) else {}

    # 1. Log sanitized input metadata (redacting base64 payloads and secrets)
    safe_log = sanitize_log_dict(raw_input if isinstance(raw_input, dict) else {})
    print(
        f"[RunPod Job {job_id}] Received try-on request with parameters: {safe_log}",
        file=sys.stderr,
    )

    # 2. Input validation
    clean_config, err = validate_input_payload(raw_input)
    if err:
        return {
            "status": "error",
            "error_type": "ValidationError",
            "message": f"Input validation failed: {err}",
        }

    # 3. Preprocessing & Mask Generation (matching official CatVTON app.py lines 154-167)
    t_preprocess_start = time.time()
    try:
        person_raw = decode_image(clean_config["person_image"])
        garment_raw = decode_image(clean_config["garment_image"])

        # Official CatVTON preprocessing:
        # - person_image uses center crop + resize to (768, 1024)
        # - garment_image (cloth_image) uses aspect-preserving resize + white padding to (768, 1024)
        person_img = resize_and_crop(person_raw, size=(CANONICAL_WIDTH, CANONICAL_HEIGHT))
        garment_img = resize_and_padding(garment_raw, size=(CANONICAL_WIDTH, CANONICAL_HEIGHT))

        # Phase 3: cut the mannequin out of the 3D-viewer screenshot (no UI chips,
        # no whitespace) and centre it on a plain studio background.
        reframe_info = {"applied": False, "reason": "disabled"}
        if clean_config["reframe_person"]:
            person_img, reframe_info = reframe_mannequin_capture(
                person_img, size=(CANONICAL_WIDTH, CANONICAL_HEIGHT)
            )

        pipe = get_pipeline()

        mask_info = {"refinement": "provided_mask"}
        mask_raw_str = clean_config.get("mask_image")
        if mask_raw_str:
            mask_decoded = decode_image(mask_raw_str)
            mask_img = validate_mask(mask_decoded, target_size=(CANONICAL_WIDTH, CANONICAL_HEIGHT))
            used_masking_strategy = "provided"
        else:
            # Automatic Masking via official AutoMasker (DensePose + SCHP)
            mask_img = pipe.generate_auto_mask(
                person_image=person_img,
                category=clean_config["category"],
                sleeve_length=clean_config["sleeve_length"],
                mask_refinement=clean_config["mask_refinement"],
                hem_extend_ratio=clean_config["hem_extend_ratio"],
            )
            mask_info = dict(getattr(pipe, "last_mask_info", {}) or {})
            used_masking_strategy = "auto"

        # Verify mask dimensions (768x1024), torso coverage, and faceless head preservation
        mask_verification = verify_mask_torso_and_head_regions(
            mask_img,
            category=clean_config["category"],
            target_size=(CANONICAL_WIDTH, CANONICAL_HEIGHT),
        )

    except Exception as e:
        return {
            "status": "error",
            "error_type": "PreprocessingError",
            "message": f"Image or mask preprocessing failed: {str(e)}",
        }

    t_preprocess_ms = int((time.time() - t_preprocess_start) * 1000)

    # 4. Inference execution (blurs mask with blur_factor=9, runs CatVTONPipeline, repaints unmasked head/bg)
    t_inference_start = time.time()
    try:
        output_image = pipe.infer(
            person_image=person_img,
            garment_image=garment_img,
            mask_image=mask_img,
            num_inference_steps=clean_config["num_inference_steps"],
            guidance_scale=clean_config["guidance_scale"],
            seed=clean_config.get("seed"),
            repaint=clean_config["repaint"],
        )
    except Exception as e:
        return {
            "status": "error",
            "error_type": "InferenceError",
            "message": f"Diffusion inference failed: {str(e)}",
        }

    t_inference_ms = int((time.time() - t_inference_start) * 1000)
    t_total_ms = int((time.time() - t_start) * 1000)

    # 5. Output encoding
    output_b64 = encode_image_to_base64(output_image, format="PNG")
    mask_b64 = encode_image_to_base64(mask_img, format="PNG")

    print(
        f"[RunPod Job {job_id}] Successfully generated try-on result: "
        f"masking={used_masking_strategy} ({clean_config['automasker_part']}), "
        f"preprocess={t_preprocess_ms}ms, inference={t_inference_ms}ms, total={t_total_ms}ms",
        file=sys.stderr,
    )

    response = {
        "status": "success",
        "image_base64": output_b64,
        "mask_base64": mask_b64,
        "person_reframe": reframe_info,
        "mask_refinement": mask_info,
        "sleeve_length": clean_config["sleeve_length"],
        "category": clean_config["category"],
        "automasker_part": clean_config["automasker_part"],
        "masking_strategy": used_masking_strategy,
        "mask_verification": mask_verification,
        "metrics": {
            "preprocessing_ms": t_preprocess_ms,
            "inference_ms": t_inference_ms,
            "total_ms": t_total_ms,
            "output_resolution": f"{output_image.width}x{output_image.height}",
            "device": getattr(pipe, "device", "cuda"),
            "dtype": str(getattr(pipe, "weight_dtype", "torch.bfloat16")),
        },
    }
    if clean_config["return_debug_images"]:
        response["person_base64"] = encode_image_to_base64(person_img, format="PNG")
    return response


if __name__ == "__main__":
    if runpod is not None:
        runpod.serverless.start({"handler": handler})
    else:
        import json

        print(
            "[RunPod Worker] 'runpod' package not installed. Running local check with test_input.json..."
        )
        with open("test_input.json", "r", encoding="utf-8") as f:
            test_job = json.load(f)
        result = handler({"id": "local_direct_test", "input": test_job.get("input", {})})
        print(f"[RunPod Worker] Test result status: {result.get('status')}")
        if result.get("status") == "error":
            print(f"[RunPod Worker] Message: {result.get('message')}")
