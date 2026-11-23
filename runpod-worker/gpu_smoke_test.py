"""
FitSync Module 4 — Documented GPU Smoke Test for CatVTON + AutoMasker
Executes one complete end-to-end Virtual Try-On inference on a CUDA GPU (>= 8GB VRAM)
using the same `person_image`, `garment_image`, and `upper_body` automatic masking flow
validated in the Google Colab Tesla T4 proof of concept.

Usage (on Colab T4 / RunPod Pod / Container with >= 8GB VRAM):
    python3 gpu_smoke_test.py
    python3 gpu_smoke_test.py --person path/to/mannequin.png --garment path/to/jersey.png --category upper_body
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from preprocessor import decode_image, encode_image_to_base64  # noqa: E402
from PIL import Image  # noqa: E402
import handler as worker_handler  # noqa: E402


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Run a single CatVTON + AutoMasker GPU smoke test."
    )
    parser.add_argument(
        "--input-json",
        type=str,
        default=os.path.join(WORKER_DIR, "test_input.json"),
        help="Path to JSON payload containing person_image, garment_image, and category.",
    )
    parser.add_argument(
        "--person",
        type=str,
        default=None,
        help="Optional override path to a person/mannequin PNG/JPG image.",
    )
    parser.add_argument(
        "--garment",
        type=str,
        default=None,
        help="Optional override path to a garment PNG/JPG image (e.g., Jersey Padini).",
    )
    parser.add_argument(
        "--category",
        type=str,
        default="upper_body",
        choices=["upper_body", "lower_body", "dresses", "upper", "lower", "overall"],
        help="Garment category (default: upper_body -> AutoMasker 'upper').",
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=50,
        help="Number of diffusion inference steps (default: 50).",
    )
    parser.add_argument(
        "--guidance",
        type=float,
        default=2.5,
        help="Classifier-free guidance scale (default: 2.5).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Deterministic random seed (default: 42).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=WORKER_DIR,
        help="Directory to write gpu_smoke_mask.png and gpu_smoke_output.png when explicit paths are omitted.",
    )
    parser.add_argument(
        "--output-mask",
        type=str,
        default=None,
        help="Optional explicit output file path for the generated agnostic mask PNG.",
    )
    parser.add_argument(
        "--output-image",
        type=str,
        default=None,
        help="Optional explicit output file path for the generated CatVTON output PNG.",
    )
    parser.add_argument(
        "--sleeve-length",
        type=str,
        default="auto",
        choices=["auto", "sleeveless", "short_sleeve", "long_sleeve"],
        help="Garment sleeve length used to protect the mannequin's forearms (default: auto = official long mask).",
    )
    parser.add_argument(
        "--mask-refinement",
        type=str,
        default="fitsync",
        choices=["fitsync", "official"],
        help="'fitsync' = DensePose-part mask with straight hem; 'official' = unmodified AutoMasker hull mask.",
    )
    parser.add_argument(
        "--no-reframe",
        action="store_true",
        help="Disable cutting the mannequin out of the UI screenshot.",
    )
    parser.add_argument(
        "--output-person",
        type=str,
        default=None,
        help="Optional output path for the preprocessed (reframed) mannequin actually sent to CatVTON.",
    )
    parser.add_argument(
        "--require-gpu",
        action="store_true",
        help="Exit non-zero if a compatible CUDA GPU or matching CUDA compiler is unavailable.",
    )
    return parser.parse_args(argv)


def _read_nvcc_release(nvcc_bin: str):
    if not nvcc_bin or not os.path.exists(nvcc_bin):
        return None
    try:
        out = subprocess.check_output([nvcc_bin, "--version"], stderr=subprocess.STDOUT, text=True)
        match = re.search(r"release (\d+\.\d+)", out)
        return match.group(1) if match else None
    except Exception:
        return None


def _detect_nvcc_cuda_version():
    cuda_home = os.environ.get("CUDA_HOME") or os.environ.get("CUDA_PATH")
    nvcc_bin = os.path.join(cuda_home, "bin", "nvcc") if cuda_home else shutil.which("nvcc")
    if not nvcc_bin or not os.path.exists(nvcc_bin):
        return None, cuda_home
    resolved_home = cuda_home or os.path.dirname(os.path.dirname(nvcc_bin))
    return _read_nvcc_release(nvcc_bin), resolved_home


def _activate_isolated_cuda_toolkit(torch_cuda: str, candidate_dir: str = "/content/cuda-12.1") -> bool:
    """Switch CUDA_HOME/PATH to an isolated matching toolkit when system nvcc mismatches PyTorch."""
    nvcc_ver = _read_nvcc_release(os.path.join(candidate_dir, "bin", "nvcc"))
    if not nvcc_ver or not torch_cuda or nvcc_ver.split(".")[0] != torch_cuda.split(".")[0]:
        return False

    os.environ["CUDA_HOME"] = candidate_dir
    os.environ["CUDA_PATH"] = candidate_dir
    host_bin = os.path.join(candidate_dir, "host-bin")
    cuda_bin = os.path.join(candidate_dir, "bin")
    prepend = [p for p in (host_bin, cuda_bin) if os.path.isdir(p)]
    existing = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p and p not in prepend]
    os.environ["PATH"] = os.pathsep.join(prepend + existing)
    if os.path.exists(os.path.join(host_bin, "g++")):
        os.environ["CXX"] = os.path.join(host_bin, "g++")
        os.environ["CUDAHOSTCXX"] = os.path.join(host_bin, "g++")
    if os.path.exists(os.path.join(host_bin, "gcc")):
        os.environ["CC"] = os.path.join(host_bin, "gcc")
    return True


def check_gpu_readiness(min_vram_gb: float = 8.0) -> bool:
    try:
        import torch
    except ImportError:
        print("[GPU Smoke Test] SKIPPED: PyTorch ('torch') is not installed on this host.")
        return False

    if not torch.cuda.is_available():
        print("[GPU Smoke Test] SKIPPED: No CUDA GPU detected (`torch.cuda.is_available() == False`).")
        return False

    props = torch.cuda.get_device_properties(0)
    vram_gb = props.total_memory / (1024 ** 3)
    nvcc_ver, resolved_cuda_home = _detect_nvcc_cuda_version()
    if torch.version.cuda and (not nvcc_ver or nvcc_ver.split(".")[0] != torch.version.cuda.split(".")[0]):
        if _activate_isolated_cuda_toolkit(torch.version.cuda):
            nvcc_ver, resolved_cuda_home = _detect_nvcc_cuda_version()
    print(
        f"[GPU Smoke Test] Detected GPU: {props.name} ({vram_gb:.2f} GB VRAM, "
        f"torch={torch.__version__}, torch_cuda={torch.version.cuda}, "
        f"CUDA_HOME={resolved_cuda_home or '<unset>'}, nvcc={nvcc_ver or '<none>'})"
    )
    if vram_gb < min_vram_gb:
        print(
            f"[GPU Smoke Test] SKIPPED: {props.name} has {vram_gb:.2f} GB VRAM, "
            f"which is below the {min_vram_gb:.1f} GB minimum required for CatVTON + AutoMasker at 768x1024."
        )
        return False

    if nvcc_ver and torch.version.cuda:
        nvcc_major = nvcc_ver.split(".")[0]
        torch_major = torch.version.cuda.split(".")[0]
        if nvcc_major != torch_major:
            raise RuntimeError(
                f"CUDA compiler mismatch: active nvcc ({nvcc_ver} at {resolved_cuda_home}) does not match "
                f"PyTorch CUDA ({torch.version.cuda}). Run Cell 1 to configure the isolated CUDA {torch.version.cuda} compiler."
            )

    return True


def main() -> int:
    args = parse_args()

    if not check_gpu_readiness(min_vram_gb=8.0):
        return 1 if args.require_gpu else 0

    with open(args.input_json, "r", encoding="utf-8") as f:
        job = json.load(f)

    payload = job.get("input", {})
    if args.person:
        payload["person_image"] = encode_image_to_base64(Image.open(args.person).convert("RGB"))
    if args.garment:
        payload["garment_image"] = encode_image_to_base64(Image.open(args.garment).convert("RGB"))

    payload["category"] = args.category
    payload["masking_strategy"] = "auto"
    payload.pop("mask_image", None)
    payload["num_inference_steps"] = args.steps
    payload["guidance_scale"] = args.guidance
    payload["seed"] = args.seed
    payload["repaint"] = True
    payload["sleeve_length"] = args.sleeve_length
    payload["mask_refinement"] = args.mask_refinement
    payload["reframe_person"] = not args.no_reframe
    payload["return_debug_images"] = True

    print(
        f"[GPU Smoke Test] Running handler with category='{payload['category']}', "
        f"masking_strategy='auto', sleeve_length='{args.sleeve_length}', mask_refinement='{args.mask_refinement}', "
        f"reframe={not args.no_reframe}, steps={args.steps}, guidance={args.guidance}, seed={args.seed}..."
    )
    result = worker_handler.handler({"id": "gpu_smoke_test_01", "input": payload})

    if result.get("status") != "success":
        print(f"[GPU Smoke Test] FAILED: {json.dumps(result, indent=2)}")
        return 1

    mask_img = decode_image(result["mask_base64"]).convert("L")
    output_img = decode_image(result["image_base64"])

    mask_path = args.output_mask or os.path.join(args.output_dir, "gpu_smoke_mask.png")
    output_path = args.output_image or os.path.join(args.output_dir, "gpu_smoke_output.png")
    os.makedirs(os.path.dirname(os.path.abspath(mask_path)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    mask_img.save(mask_path)
    output_img.save(output_path)
    person_path = args.output_person or os.path.join(args.output_dir, "gpu_smoke_person.png")
    if result.get("person_base64"):
        os.makedirs(os.path.dirname(os.path.abspath(person_path)), exist_ok=True)
        decode_image(result["person_base64"]).save(person_path)

    # Assert expected output contract
    assert output_img.size == (768, 1024), f"Expected 768x1024 output, got {output_img.size}"
    assert mask_img.size == (768, 1024), f"Expected 768x1024 mask, got {mask_img.size}"
    assert result.get("masking_strategy") == "auto"
    assert result.get("mask_verification", {}).get("valid") is True

    summary = {
        "status": result["status"],
        "category": result["category"],
        "automasker_part": result["automasker_part"],
        "masking_strategy": result["masking_strategy"],
        "sleeve_length": result.get("sleeve_length"),
        "person_reframe": result.get("person_reframe"),
        "mask_refinement": result.get("mask_refinement"),
        "mask_verification": result["mask_verification"],
        "metrics": result["metrics"],
        "saved_files": {
            "mask_png": mask_path,
            "output_png": output_path,
            "person_png": person_path if result.get("person_base64") else None,
        },
    }
    print("[GPU Smoke Test] PASSED!")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

