"""
FitSync Module 4 — CatVTON RunPod Worker Unit Test Suite (Phase 2)
Tests:
  1. Mask dimensions (768x1024 normalization, resize_and_crop, resize_and_padding, blur_factor=9)
  2. Torso-region coverage & faceless mannequin head preservation across 'upper_body', 'lower_body', 'dresses'
  3. Invalid image inputs, corrupted base64, oversized payloads, and schema validation
  4. Model & AutoMasker loading configuration and end-to-end handler execution with automatic masking
"""

import base64
import io
import json
import os
import sys
import tempfile
import types
import unittest
import numpy as np
from PIL import Image, ImageDraw

# Ensure runpod-worker directory is in sys.path
WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from preprocessor import (  # noqa: E402
    ATR_MAPPING,
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    DENSE_INDEX_MAP,
    LIP_MAPPING,
    blur_agnostic_mask,
    compute_cloth_agnostic_mask,
    decode_image,
    encode_image_to_base64,
    enforce_faceless_mannequin_head_protection,
    map_category_to_automasker_part,
    repaint_result,
    resize_and_crop,
    resize_and_padding,
    sanitize_log_dict,
    validate_input_payload,
    validate_mask,
    verify_mask_torso_and_head_regions,
)
from catvton_pipeline import (  # noqa: E402
    CatVTONInferenceWrapper,
    _ensure_catvton_repo_on_path,
    resolve_model_config,
)
import gpu_smoke_test  # noqa: E402
import handler as worker_handler  # noqa: E402
from fitsync_mask import build_fitsync_upper_mask, reframe_mannequin_capture  # noqa: E402


def build_synthetic_mannequin_maps(
    width: int = CANONICAL_WIDTH, height: int = CANONICAL_HEIGHT
):
    """
    Builds synthetic 768x1024 DensePose, SCHP-LIP, and SCHP-ATR segmentation maps
    matching a front-view FitSync faceless mannequin.
    """
    dp = Image.new("L", (width, height), 0)
    lip = Image.new("L", (width, height), 0)
    atr = Image.new("L", (width, height), 0)

    draw_dp = ImageDraw.Draw(dp)
    draw_lip = ImageDraw.Draw(lip)
    draw_atr = ImageDraw.Draw(atr)

    # 1. Head / Face region (y: 6% to 15% of height) -> Protected!
    head_box = (int(width * 0.40), int(height * 0.06), int(width * 0.60), int(height * 0.15))
    draw_dp.ellipse(head_box, fill=DENSE_INDEX_MAP["face"][0])  # 23
    draw_lip.ellipse(head_box, fill=LIP_MAPPING["Face"])  # 13
    draw_atr.ellipse(head_box, fill=ATR_MAPPING["Face"])  # 11

    # 2. Torso / Upper-clothes region (y: 23% to 51% of height)
    torso_box = (int(width * 0.30), int(height * 0.23), int(width * 0.70), int(height * 0.51))
    draw_dp.rectangle(torso_box, fill=DENSE_INDEX_MAP["torso"][0])  # 1
    draw_lip.rectangle(torso_box, fill=LIP_MAPPING["Upper-clothes"])  # 5
    draw_atr.rectangle(torso_box, fill=ATR_MAPPING["Upper-clothes"])  # 4

    # 3. Left & Right Upper Arms (y: 24% to 44% of height)
    l_arm_box = (int(width * 0.22), int(height * 0.24), int(width * 0.30), int(height * 0.44))
    r_arm_box = (int(width * 0.70), int(height * 0.24), int(width * 0.78), int(height * 0.44))
    draw_dp.rectangle(l_arm_box, fill=DENSE_INDEX_MAP["left big arm"][0])  # 15
    draw_dp.rectangle(r_arm_box, fill=DENSE_INDEX_MAP["right big arm"][0])  # 16
    draw_lip.rectangle(l_arm_box, fill=LIP_MAPPING["Left-arm"])  # 14
    draw_lip.rectangle(r_arm_box, fill=LIP_MAPPING["Right-arm"])  # 15
    draw_atr.rectangle(l_arm_box, fill=ATR_MAPPING["Left-arm"])  # 14
    draw_atr.rectangle(r_arm_box, fill=ATR_MAPPING["Right-arm"])  # 15

    # 4. Hands (y: 50% to 55% of height) -> Protected!
    l_hand_box = (int(width * 0.20), int(height * 0.50), int(width * 0.26), int(height * 0.55))
    r_hand_box = (int(width * 0.74), int(height * 0.50), int(width * 0.80), int(height * 0.55))
    draw_dp.rectangle(l_hand_box, fill=DENSE_INDEX_MAP["left hand"][0])  # 4
    draw_dp.rectangle(r_hand_box, fill=DENSE_INDEX_MAP["right hand"][0])  # 3

    # 5. Lower Body / Pants & Legs (y: 58% to 85% of height)
    lower_box = (int(width * 0.32), int(height * 0.58), int(width * 0.68), int(height * 0.85))
    draw_dp.rectangle(lower_box, fill=DENSE_INDEX_MAP["right thigh"][0])  # 7
    draw_lip.rectangle(lower_box, fill=LIP_MAPPING["Pants"])  # 9
    draw_atr.rectangle(lower_box, fill=ATR_MAPPING["Pants"])  # 6

    return dp, lip, atr


class TestCatVTONWorkerPhase2(unittest.TestCase):
    """Unit tests for FitSync Module 4 Phase 2 CatVTON Worker."""

    def test_01_mask_and_image_dimensions(self):
        """Verifies canonical 768x1024 dimensions for person, garment, and agnostic masks."""
        # Non-standard input aspect ratios
        wide_person = Image.new("RGB", (1200, 900), (240, 238, 232))
        square_garment = Image.new("RGB", (600, 600), (30, 64, 175))

        cropped_person = resize_and_crop(wide_person)
        padded_garment = resize_and_padding(square_garment)

        self.assertEqual(cropped_person.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        self.assertEqual(cropped_person.mode, "RGB")
        self.assertEqual(padded_garment.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        self.assertEqual(padded_garment.mode, "RGB")
        # Top-left padding of square garment should be pure white (255, 255, 255)
        self.assertEqual(padded_garment.getpixel((10, 10)), (255, 255, 255))

        # Validate small mask resizes to 768x1024 mode 'L'
        small_mask = Image.new("L", (384, 512), 0)
        draw = ImageDraw.Draw(small_mask)
        draw.rectangle((100, 120, 284, 260), fill=255)
        norm_mask = validate_mask(small_mask)
        self.assertEqual(norm_mask.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        self.assertEqual(norm_mask.mode, "L")

        # Verify mask blurring (blur_factor=9 matching official app.py) preserves 768x1024 'L'
        blurred = blur_agnostic_mask(norm_mask, blur_factor=9)
        self.assertEqual(blurred.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        self.assertEqual(blurred.mode, "L")

    def test_02_torso_region_and_faceless_head_preservation(self):
        """
        Verifies AutoMasker cloth-agnostic mask computation & regional invariants:
        - Upper-body mask covers torso/arms while preserving the faceless head and lower legs.
        - Lower-body mask covers legs/pants while preserving the head and upper torso.
        - Dresses ('overall') mask covers both torso and lower body while preserving the faceless head.
        """
        dp, lip, atr = build_synthetic_mannequin_maps()

        # 1. Upper-body ('upper_body' -> 'upper')
        upper_mask = compute_cloth_agnostic_mask(dp, lip, atr, part="upper_body")
        self.assertEqual(upper_mask.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        upper_metrics = verify_mask_torso_and_head_regions(upper_mask, category="upper_body")
        self.assertTrue(upper_metrics["valid"])
        self.assertEqual(upper_metrics["automasker_part"], "upper")
        self.assertEqual(upper_metrics["head_inpaint_ratio"], 0.0)
        self.assertGreaterEqual(upper_metrics["torso_inpaint_ratio"], 0.40)
        self.assertLess(upper_metrics["lower_inpaint_ratio"], 0.05)

        # Hands must also be protected (0)
        hand_center_px = upper_mask.getpixel((int(CANONICAL_WIDTH * 0.23), int(CANONICAL_HEIGHT * 0.52)))
        self.assertEqual(hand_center_px, 0)

        # 2. Lower-body ('lower_body' -> 'lower')
        lower_mask = compute_cloth_agnostic_mask(dp, lip, atr, part="lower_body")
        lower_metrics = verify_mask_torso_and_head_regions(lower_mask, category="lower_body")
        self.assertTrue(lower_metrics["valid"])
        self.assertEqual(lower_metrics["automasker_part"], "lower")
        self.assertEqual(lower_metrics["head_inpaint_ratio"], 0.0)
        self.assertGreaterEqual(lower_metrics["lower_inpaint_ratio"], 0.40)
        self.assertLess(lower_metrics["torso_inpaint_ratio"], 0.05)

        # 3. Dresses ('dresses' -> 'overall')
        overall_mask = compute_cloth_agnostic_mask(dp, lip, atr, part="dresses")
        overall_metrics = verify_mask_torso_and_head_regions(overall_mask, category="dresses")
        self.assertTrue(overall_metrics["valid"])
        self.assertEqual(overall_metrics["automasker_part"], "overall")
        self.assertEqual(overall_metrics["head_inpaint_ratio"], 0.0)
        self.assertGreaterEqual(overall_metrics["torso_inpaint_ratio"], 0.40)
        self.assertGreaterEqual(overall_metrics["lower_inpaint_ratio"], 0.40)

        # 4. Reject corrupted mask that erases the faceless head
        bad_head_mask = upper_mask.copy()
        draw_bad = ImageDraw.Draw(bad_head_mask)
        draw_bad.rectangle((250, 10, 520, 150), fill=255)
        with self.assertRaises(ValueError) as ctx:
            verify_mask_torso_and_head_regions(bad_head_mask, category="upper_body")
        self.assertIn("faceless head region is not preserved", str(ctx.exception))

        # 5. Verify enforce_faceless_mannequin_head_protection repairs SCHP head leak using DensePose
        repaired_mask = enforce_faceless_mannequin_head_protection(
            bad_head_mask, densepose_mask=dp, category="upper_body"
        )
        repaired_metrics = verify_mask_torso_and_head_regions(repaired_mask, category="upper_body")
        self.assertTrue(repaired_metrics["valid"])
        self.assertEqual(repaired_metrics["head_inpaint_ratio"], 0.0)

    def test_03_invalid_image_inputs_and_payload_validation(self):
        """Tests rejection of invalid images, malformed base64, all-black/white masks, and bad params."""
        # Empty / non-string image inputs
        with self.assertRaises(ValueError):
            decode_image("")
        with self.assertRaises(ValueError):
            decode_image("   ")

        # Malformed base64
        with self.assertRaises(ValueError):
            decode_image("data:image/png;base64,NOT_VALID_BASE64!!!")

        # Valid base64 but not an image
        not_an_image_b64 = base64.b64encode(b"hello world not a png").decode("utf-8")
        with self.assertRaises(ValueError):
            decode_image(not_an_image_b64)

        # Oversized payload limit
        img = Image.new("RGB", (64, 64), (120, 120, 120))
        b64_img = encode_image_to_base64(img)
        with self.assertRaises(ValueError):
            decode_image(b64_img, max_bytes=50)

        # Completely black mask -> ValueError
        all_black = Image.new("L", (CANONICAL_WIDTH, CANONICAL_HEIGHT), 0)
        with self.assertRaises(ValueError):
            validate_mask(all_black)

        # Completely white mask -> ValueError
        all_white = Image.new("L", (CANONICAL_WIDTH, CANONICAL_HEIGHT), 255)
        with self.assertRaises(ValueError):
            validate_mask(all_white)

        # Invalid category ('shoes' is not supported by CatVTON)
        _, err = validate_input_payload(
            {"person_image": b64_img, "garment_image": b64_img, "category": "shoes"}
        )
        self.assertIsNotNone(err)
        self.assertIn("Invalid 'category'", err)

        # Out-of-range inference steps
        _, err = validate_input_payload(
            {"person_image": b64_img, "garment_image": b64_img, "num_inference_steps": 5}
        )
        self.assertIsNotNone(err)
        self.assertIn("num_inference_steps", err)

        # Secret and base64 log redaction
        sanitized = sanitize_log_dict(
            {
                "person_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                "runpod_api_key": "rpa_secret_123",
                "category": "upper_body",
            }
        )
        self.assertEqual(sanitized["runpod_api_key"], "<redacted>")
        self.assertTrue(sanitized["person_image"].startswith("<base64_image_len_"))
        self.assertEqual(sanitized["category"], "upper_body")

    def test_04_model_loading_configuration_and_auto_mask_handler(self):
        """Tests model configuration resolution, category mapping, and end-to-end handler flow."""
        # Category mappings matching both FitSync ('upper_body') and Colab Gradio ('upper')
        self.assertEqual(map_category_to_automasker_part("upper_body"), "upper")
        self.assertEqual(map_category_to_automasker_part("upper"), "upper")
        self.assertEqual(map_category_to_automasker_part("lower_body"), "lower")
        self.assertEqual(map_category_to_automasker_part("lower"), "lower")
        self.assertEqual(map_category_to_automasker_part("dresses"), "overall")
        self.assertEqual(map_category_to_automasker_part("overall"), "overall")

        # Default model config check
        cfg = resolve_model_config()
        self.assertEqual(cfg["attn_ckpt"], "zhengchong/CatVTON")
        self.assertEqual(cfg["attn_ckpt_version"], "mix")
        self.assertEqual(cfg["densepose_subdir"], "DensePose")
        self.assertEqual(cfg["schp_subdir"], "SCHP")
        self.assertEqual(cfg["canonical_width"], 768)
        self.assertEqual(cfg["canonical_height"], 1024)
        self.assertTrue(cfg["skip_safety_check"])

        # Invalid attn_ckpt_version or device should raise ValueError
        with self.assertRaises(ValueError):
            resolve_model_config(attn_ckpt_version="invalid_version")
        with self.assertRaises(ValueError):
            resolve_model_config(device="tpu")

        # Test lazy initialization of CatVTONInferenceWrapper and end-to-end handler with test_input.json
        dp, lip, atr = build_synthetic_mannequin_maps()
        auto_upper_mask = compute_cloth_agnostic_mask(dp, lip, atr, part="upper_body")

        wrapper = CatVTONInferenceWrapper(lazy_load=True)
        wrapper.automasker = lambda person_img, cloth_type: {"mask": auto_upper_mask}
        wrapper.pipeline = lambda **kwargs: [
            Image.new("RGB", (CANONICAL_WIDTH, CANONICAL_HEIGHT), (30, 64, 175))
        ]

        # Inject mock wrapper into handler singleton
        worker_handler.pipeline_wrapper = wrapper

        test_json_path = os.path.join(WORKER_DIR, "test_input.json")
        with open(test_json_path, "r", encoding="utf-8") as f:
            job_payload = json.load(f)

        response = worker_handler.handler({"id": "unit_test_job", "input": job_payload["input"]})
        self.assertEqual(response["status"], "success")
        self.assertEqual(response["category"], "upper_body")
        self.assertEqual(response["automasker_part"], "upper")
        self.assertEqual(response["masking_strategy"], "auto")
        self.assertTrue(response["mask_verification"]["valid"])
        self.assertEqual(response["mask_verification"]["head_inpaint_ratio"], 0.0)
        self.assertEqual(response["metrics"]["output_resolution"], "768x1024")

        # Decode output image and verify faceless head pixel (384, 120) was preserved via repaint_result
        out_img = decode_image(response["image_base64"])
        in_person = resize_and_crop(decode_image(job_payload["input"]["person_image"]))
        if response["person_reframe"]["applied"]:
            in_person, _ = reframe_mannequin_capture(in_person)
        self.assertEqual(out_img.size, (CANONICAL_WIDTH, CANONICAL_HEIGHT))
        self.assertEqual(out_img.getpixel((384, 120)), in_person.getpixel((384, 120)))
        # And torso center pixel (384, 380) was replaced with the jersey color (30, 64, 175)
        self.assertEqual(out_img.getpixel((384, 380)), (30, 64, 175))

    def test_05_smoke_test_cli_and_repo_path_resolution(self):
        """Verifies gpu_smoke_test CLI flags and CATVTON_REPO_PATH sys.path resolution."""
        parsed = gpu_smoke_test.parse_args([
            "--person", "mannequin.png",
            "--garment", "jersey.png",
            "--output-mask", "out/mask.png",
            "--output-image", "out/tryon.png",
            "--require-gpu",
        ])
        self.assertEqual(parsed.person, "mannequin.png")
        self.assertEqual(parsed.garment, "jersey.png")
        self.assertEqual(parsed.output_mask, "out/mask.png")
        self.assertEqual(parsed.output_image, "out/tryon.png")
        self.assertTrue(parsed.require_gpu)

        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "model")
            os.makedirs(model_dir, exist_ok=True)
            with open(os.path.join(model_dir, "pipeline.py"), "w", encoding="utf-8") as f:
                f.write("# stub\n")

            prev_env = os.environ.get("CATVTON_REPO_PATH")
            prev_sys_path = list(sys.path)
            prev_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                os.environ["CATVTON_REPO_PATH"] = tmpdir
                resolved = _ensure_catvton_repo_on_path()
                self.assertEqual(resolved, os.path.abspath(tmpdir))
                self.assertIn(os.path.abspath(tmpdir), sys.path)
                self.assertTrue(os.path.isdir(os.path.join(tmpdir, "densepose_", "tmp")))

                # Simulate CatVTON's vendored Python 3.9 detectron2/ folder shadowing sys.path[0]
                vendored_d2 = os.path.join(tmpdir, "detectron2")
                os.makedirs(vendored_d2, exist_ok=True)
                with open(os.path.join(vendored_d2, "__init__.py"), "w", encoding="utf-8") as f:
                    f.write("# python 3.9 vendored stub\n")
                sys.path.insert(0, os.path.abspath(tmpdir))
                shadow_mod = types.ModuleType("detectron2")
                shadow_mod.__file__ = os.path.join(vendored_d2, "__init__.py")
                prev_d2_mod = sys.modules.get("detectron2")
                sys.modules["detectron2"] = shadow_mod
                try:
                    _ensure_catvton_repo_on_path()
                    self.assertEqual(sys.path[-1], os.path.abspath(tmpdir))
                    self.assertNotIn("detectron2", sys.modules)
                finally:
                    if prev_d2_mod is not None:
                        sys.modules["detectron2"] = prev_d2_mod
                    else:
                        sys.modules.pop("detectron2", None)
            finally:
                os.chdir(prev_cwd)
                sys.path[:] = prev_sys_path
                if prev_env is None:
                    os.environ.pop("CATVTON_REPO_PATH", None)
                else:
                    os.environ["CATVTON_REPO_PATH"] = prev_env

            # Verify isolated CUDA 12.1 toolkit fallback switches CUDA_HOME/PATH on mismatch
            from unittest import mock

            prev_cuda_home = os.environ.get("CUDA_HOME")
            prev_cuda_path = os.environ.get("CUDA_PATH")
            prev_path = os.environ.get("PATH", "")
            try:
                iso_dir = os.path.join(tmpdir, "cuda-12.1")
                os.makedirs(os.path.join(iso_dir, "bin"), exist_ok=True)
                os.makedirs(os.path.join(iso_dir, "host-bin"), exist_ok=True)
                os.environ["CUDA_HOME"] = "/usr/local/cuda"
                with mock.patch.object(gpu_smoke_test, "_read_nvcc_release", return_value="12.1"):
                    self.assertTrue(gpu_smoke_test._activate_isolated_cuda_toolkit("12.1", candidate_dir=iso_dir))
                self.assertEqual(os.environ.get("CUDA_HOME"), iso_dir)
                self.assertEqual(os.environ.get("CUDA_PATH"), iso_dir)
                self.assertTrue(os.environ["PATH"].startswith(os.path.join(iso_dir, "host-bin")))

                with mock.patch.object(gpu_smoke_test, "_read_nvcc_release", return_value="13.0"):
                    self.assertFalse(gpu_smoke_test._activate_isolated_cuda_toolkit("12.1", candidate_dir=iso_dir))
            finally:
                os.environ["PATH"] = prev_path
                for key, old_val in (("CUDA_HOME", prev_cuda_home), ("CUDA_PATH", prev_cuda_path)):
                    if old_val is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = old_val


    def test_06_mannequin_realism_reframe_sleeves_and_hem(self):
        """
        Phase 3 quality regression checks (CPU only, NOT a GPU result):
          - UI screenshot is reframed: mannequin centred, UI corners become plain background.
          - short_sleeve mask keeps forearms + lower upper-arms + hands unmasked.
          - long_sleeve mask still covers forearms (long-sleeve tops keep working).
          - hem is a straight horizontal line (no pointed V / triangles) and the
            faceless head stays unmasked.
        """
        W, H = CANONICAL_WIDTH, CANONICAL_HEIGHT

        # --- 1. Reframe the real FitSync UI screenshot sample
        sample = Image.open(os.path.join(WORKER_DIR, "samples", "mannequin_front_768x1024.png")).convert("RGB")
        reframed, info = reframe_mannequin_capture(sample)
        self.assertTrue(info["applied"], info)
        self.assertEqual(reframed.size, (W, H))
        # UI chip corners ("Regular Fit", "Front" button) are gone -> flat background colour
        bg = tuple(info["background_rgb"])
        for xy in [(40, 145), (735, 148), (60, 830), (10, 10), (760, 1015)]:
            self.assertEqual(reframed.getpixel(xy), bg, f"pixel {xy} not clean background")
        # Mannequin got bigger (fills more of the frame than the original screenshot)
        self.assertGreater(info["scale"], 1.2)

        # --- 2. Synthetic A-pose DensePose map with forearms
        dp = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(dp)
        d.ellipse((345, 55, 420, 165), fill=DENSE_INDEX_MAP["face"][0])
        d.rectangle((300, 205, 465, 505), fill=DENSE_INDEX_MAP["torso"][0])
        d.line([(292, 225), (255, 355)], fill=DENSE_INDEX_MAP["left big arm"][0], width=34)
        d.line([(472, 225), (510, 355)], fill=DENSE_INDEX_MAP["right big arm"][0], width=34)
        d.line([(255, 355), (225, 450)], fill=DENSE_INDEX_MAP["left forearm"][0], width=26)
        d.line([(510, 355), (540, 450)], fill=DENSE_INDEX_MAP["right forearm"][0], width=26)
        d.ellipse((205, 440, 250, 515), fill=DENSE_INDEX_MAP["left hand"][0])
        d.ellipse((515, 440, 560, 515), fill=DENSE_INDEX_MAP["right hand"][0])
        d.polygon([(300, 505), (380, 505), (360, 900), (290, 900)], fill=DENSE_INDEX_MAP["right thigh"][0])
        d.polygon([(385, 505), (470, 505), (480, 900), (410, 900)], fill=DENSE_INDEX_MAP["left thigh"][0])
        fallback = Image.new("L", (W, H), 0)

        short_mask, short_info = build_fitsync_upper_mask(dp, fallback, sleeve_length="short_sleeve")
        long_mask, long_info = build_fitsync_upper_mask(dp, fallback, sleeve_length="long_sleeve")
        self.assertTrue(short_info["applied"])
        self.assertTrue(long_info["applied"])

        # Shoulder (top of upper arm) is sleeve in both
        self.assertEqual(short_mask.getpixel((285, 250)), 255)
        # Mid-forearm + lower upper-arm preserved for short sleeve, covered for long sleeve
        for xy in [(240, 402), (525, 402), (262, 335)]:
            self.assertEqual(short_mask.getpixel(xy), 0, f"short_sleeve masked forearm at {xy}")
        self.assertEqual(long_mask.getpixel((240, 402)), 255)
        # Hands always preserved
        self.assertEqual(short_mask.getpixel((227, 478)), 0)
        self.assertEqual(long_mask.getpixel((227, 478)), 0)

        # Straight hem: bottom edge of the mask is the same row across the torso width,
        # i.e. no pointed corners and no V-notch at the crotch.
        arr = (np.asarray(short_mask) > 127)
        bottoms = [int(np.nonzero(arr[:, x])[0].max()) for x in range(320, 450, 10)]
        self.assertLessEqual(max(bottoms) - min(bottoms), 3, f"hem not straight: {bottoms}")
        self.assertFalse(arr[short_info["hem_y"] + 5:, :].any(), "mask leaks below the hem")

        # Faceless head untouched + torso covered (existing verification still passes)
        metrics = verify_mask_torso_and_head_regions(
            enforce_faceless_mannequin_head_protection(short_mask, densepose_mask=dp), category="upper_body"
        )
        self.assertEqual(metrics["head_inpaint_ratio"], 0.0)
        self.assertGreater(metrics["torso_inpaint_ratio"], 0.4)

        # --- 3. No DensePose -> graceful fallback to the official AutoMasker mask
        fb_mask, fb_info = build_fitsync_upper_mask(None, short_mask, sleeve_length="short_sleeve")
        self.assertFalse(fb_info["applied"])
        self.assertEqual(fb_info["reason"], "densepose_unavailable")

        # --- 4. Payload validation for the new options
        img_b64 = encode_image_to_base64(Image.new("RGB", (64, 64), (120, 120, 120)))
        cfg, err = validate_input_payload({"person_image": img_b64, "garment_image": img_b64})
        self.assertIsNone(err)
        self.assertEqual(cfg["sleeve_length"], "auto")
        self.assertEqual(cfg["mask_refinement"], "fitsync")
        self.assertTrue(cfg["reframe_person"])
        _, err = validate_input_payload(
            {"person_image": img_b64, "garment_image": img_b64, "sleeve_length": "three_quarter"}
        )
        self.assertIn("sleeve_length", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)

