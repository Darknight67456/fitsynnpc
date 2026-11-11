"""
FitSync Module 4 — CatVTON Inference & AutoMasker Pipeline Wrapper (Phase 2)
Adapts the official CatVTON (ICLR 2025) Gradio `app.py` pipeline and `AutoMasker`
(DensePose + SCHP) for RunPod Serverless with singleton caching, bf16/fp16 precision,
automatic agnostic mask generation, and Gaussian mask feathering (`blur_factor=9`).
"""

import os
import sys
import time
from typing import Any, Dict, Optional
from PIL import Image

try:
    import torch
except ImportError:
    torch = None  # type: ignore

try:
    from huggingface_hub import snapshot_download
except ImportError:
    snapshot_download = None  # type: ignore

from preprocessor import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    blur_agnostic_mask,
    enforce_faceless_mannequin_head_protection,
    map_category_to_automasker_part,
    repaint_result,
    validate_mask,
)
from fitsync_mask import build_fitsync_upper_mask

# Official CatVTON checkpoint identifiers (verified against Zheng-Chong/CatVTON/app.py & HF mirrors)
DEFAULT_BASE_MODEL = os.getenv("BASE_MODEL_PATH", "booksforcharlie/stable-diffusion-inpainting")
FALLBACK_BASE_MODEL = "runwayml/stable-diffusion-inpainting"
DEFAULT_CATVTON_WEIGHTS = os.getenv("CATVTON_MODEL_PATH", "zhengchong/CatVTON")
DEFAULT_ATTN_VERSION = os.getenv("CATVTON_ATTN_VERSION", "mix")
VALID_ATTN_VERSIONS = {"mix", "vitonhd", "dresscode"}


def _is_native_bf16_supported() -> bool:
    """
    Returns True only when CUDA hardware natively supports bfloat16 (Ampere sm_80+).
    Tesla T4 (Turing sm_75) lacks native bf16 tensor cores; using fp16 avoids slow emulation.
    """
    if torch is None or not torch.cuda.is_available():
        return False
    try:
        return bool(torch.cuda.is_bf16_supported(including_emulation=False))
    except TypeError:
        major, _ = torch.cuda.get_device_capability(0)
        return major >= 8


def _ensure_catvton_repo_on_path() -> Optional[str]:
    """
    Ensures the official CatVTON repository root (containing `model/` and `utils.py`)
    is present on `sys.path` *after* installed `site-packages`, preventing CatVTON's
    vendored Python 3.9 `detectron2/` (`_C.cpython-39*.so`) and `densepose/` folders
    from shadowing the active environment's compiled binaries, and ensures `./densepose_/tmp` exists.
    """
    worker_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    env_repo = os.getenv("CATVTON_REPO_PATH")
    if env_repo:
        candidates.append(env_repo)
    candidates.extend([
        os.path.dirname(worker_dir),
        worker_dir,
        "/content/CatVTON",
        "/app",
    ])

    resolved_root: Optional[str] = None
    for candidate in candidates:
        if candidate and os.path.isfile(os.path.join(candidate, "model", "pipeline.py")):
            resolved_root = os.path.abspath(candidate)
            break

    if resolved_root:
        has_vendored_shadow = (
            os.path.isdir(os.path.join(resolved_root, "detectron2"))
            or os.path.isdir(os.path.join(resolved_root, "densepose"))
        )
        normalized_root = os.path.normcase(resolved_root)
        if has_vendored_shadow:
            sys.path[:] = [
                p for p in sys.path
                if os.path.normcase(os.path.abspath(p or os.getcwd())) != normalized_root
            ]
            for mod_name in list(sys.modules):
                if (
                    mod_name == "detectron2"
                    or mod_name.startswith("detectron2.")
                    or mod_name == "densepose"
                    or mod_name.startswith("densepose.")
                ):
                    mod = sys.modules[mod_name]
                    mod_file = getattr(mod, "__file__", None) or ""
                    mod_paths = list(getattr(mod, "__path__", []) or [])
                    from_shadow = (
                        mod_file and os.path.normcase(os.path.abspath(mod_file)).startswith(normalized_root)
                    ) or any(
                        os.path.normcase(os.path.abspath(mp)).startswith(normalized_root)
                        for mp in mod_paths
                    )
                    if from_shadow:
                        del sys.modules[mod_name]

        if resolved_root not in sys.path:
            sys.path.append(resolved_root)

    os.makedirs(os.path.join(os.getcwd(), "densepose_", "tmp"), exist_ok=True)
    return resolved_root


def resolve_model_config(
    base_ckpt: Optional[str] = None,
    attn_ckpt: Optional[str] = None,
    attn_ckpt_version: Optional[str] = None,
    device: Optional[str] = None,
    mixed_precision: Optional[str] = None,
    allow_tf32: bool = True,
    skip_safety_check: bool = True,
) -> Dict[str, Any]:
    """
    Validates and resolves the model & AutoMasker loading configuration.
    Can be tested independently on CPU hosts without downloading multi-GB weights.
    """
    resolved_base = (base_ckpt or DEFAULT_BASE_MODEL).strip()
    if not resolved_base:
        raise ValueError("base_ckpt must be a non-empty Hugging Face model ID or local path")

    resolved_attn = (attn_ckpt or DEFAULT_CATVTON_WEIGHTS).strip()
    if not resolved_attn:
        raise ValueError("attn_ckpt must be a non-empty Hugging Face repo ID or local path")

    resolved_version = (attn_ckpt_version or DEFAULT_ATTN_VERSION).strip()
    if resolved_version not in VALID_ATTN_VERSIONS:
        raise ValueError(
            f"Invalid attn_ckpt_version '{resolved_version}'. Must be one of {sorted(VALID_ATTN_VERSIONS)}"
        )

    if device is None:
        if torch is not None and torch.cuda.is_available():
            resolved_device = "cuda"
        else:
            resolved_device = "cpu"
    else:
        if device not in ("cuda", "cpu"):
            raise ValueError(f"Unsupported device '{device}'. Must be 'cuda' or 'cpu'")
        resolved_device = device

    if mixed_precision is None:
        if resolved_device == "cuda" and torch is not None:
            resolved_precision = "bf16" if _is_native_bf16_supported() else "fp16"
        else:
            resolved_precision = "no"
    else:
        if mixed_precision not in ("no", "fp16", "bf16"):
            raise ValueError(
                f"Invalid mixed_precision '{mixed_precision}'. Must be 'no', 'fp16', or 'bf16'"
            )
        resolved_precision = mixed_precision

    weight_dtype = None
    if torch is not None:
        weight_dtype = {
            "no": torch.float32,
            "fp16": torch.float16,
            "bf16": torch.bfloat16,
        }[resolved_precision]

    return {
        "base_ckpt": resolved_base,
        "attn_ckpt": resolved_attn,
        "attn_ckpt_version": resolved_version,
        "densepose_subdir": "DensePose",
        "schp_subdir": "SCHP",
        "device": resolved_device,
        "mixed_precision": resolved_precision,
        "weight_dtype": weight_dtype,
        "allow_tf32": bool(allow_tf32),
        "skip_safety_check": bool(skip_safety_check),
        "canonical_width": CANONICAL_WIDTH,
        "canonical_height": CANONICAL_HEIGHT,
    }


class CatVTONInferenceWrapper:
    """
    Singleton wrapper for both the CatVTON diffusion pipeline (`CatVTONPipeline`)
    and the automatic cloth-agnostic mask generator (`AutoMasker`: DensePose + SCHP).
    """

    _instance: Optional["CatVTONInferenceWrapper"] = None

    def __init__(
        self,
        base_ckpt: str = DEFAULT_BASE_MODEL,
        attn_ckpt: str = DEFAULT_CATVTON_WEIGHTS,
        attn_ckpt_version: str = DEFAULT_ATTN_VERSION,
        device: Optional[str] = None,
        mixed_precision: Optional[str] = None,
        load_automasker: bool = True,
        lazy_load: bool = False,
    ):
        self.config = resolve_model_config(
            base_ckpt=base_ckpt,
            attn_ckpt=attn_ckpt,
            attn_ckpt_version=attn_ckpt_version,
            device=device,
            mixed_precision=mixed_precision,
        )
        self.base_ckpt = self.config["base_ckpt"]
        self.attn_ckpt = self.config["attn_ckpt"]
        self.attn_ckpt_version = self.config["attn_ckpt_version"]
        self.device = self.config["device"]
        self.weight_dtype = self.config["weight_dtype"]
        self.load_automasker = load_automasker

        self.last_mask_info: Dict[str, Any] = {}
        self.repo_path: Optional[str] = None
        self.pipeline: Any = None
        self.automasker: Any = None

        if not lazy_load:
            if torch is None:
                raise ImportError("PyTorch ('torch') is not installed in the current environment.")
            self._load_models()

    @classmethod
    def get_instance(cls, **kwargs) -> "CatVTONInferenceWrapper":
        """Returns the cached singleton pipeline instance."""
        if cls._instance is None:
            cls._instance = cls(**kwargs)
        return cls._instance

    def _resolve_repo_path(self) -> str:
        """
        Resolves or downloads the `zhengchong/CatVTON` checkpoint directory containing
        attention (`mix-48k-1024`), `DensePose`, and `SCHP` weights while skipping unused `flux-lora` files.
        """
        if self.repo_path and os.path.exists(self.repo_path):
            return self.repo_path
        if os.path.exists(self.attn_ckpt):
            self.repo_path = self.attn_ckpt
            return self.repo_path
        if snapshot_download is None:
            raise RuntimeError("huggingface_hub.snapshot_download is required to fetch CatVTON weights.")
        self.repo_path = snapshot_download(
            repo_id=self.attn_ckpt,
            ignore_patterns=["flux-lora/*", "*.md", ".gitattributes"],
        )
        return self.repo_path

    def _load_models(self):
        """
        Loads `CatVTONPipeline` and `AutoMasker` (DensePose + SCHP) matching official `app.py`.
        Explicitly enforces `weight_dtype` on `unet` and `vae` after `load_checkpoint_in_model`
        to guarantee dtype consistency on Tesla T4 / Ampere GPUs.
        """
        start_time = time.time()
        catvton_code_root = _ensure_catvton_repo_on_path()
        print(
            f"[CatVTON] Initializing pipeline on {self.device} "
            f"(precision={self.config['mixed_precision']}, code_root={catvton_code_root or 'PYTHONPATH'})...",
            file=sys.stderr,
        )

        repo_path = self._resolve_repo_path()

        # 1. Load CatVTON Diffusion Pipeline
        try:
            from model.pipeline import CatVTONPipeline  # type: ignore

            primary_ckpt = self.base_ckpt
            try:
                self.pipeline = CatVTONPipeline(
                    base_ckpt=primary_ckpt,
                    attn_ckpt=repo_path,
                    attn_ckpt_version=self.attn_ckpt_version,
                    weight_dtype=self.weight_dtype,
                    use_tf32=self.config["allow_tf32"],
                    device=self.device,
                    skip_safety_check=self.config["skip_safety_check"],
                )
            except Exception as primary_exc:
                if FALLBACK_BASE_MODEL == primary_ckpt:
                    raise
                try:
                    self.base_ckpt = FALLBACK_BASE_MODEL
                    self.pipeline = CatVTONPipeline(
                        base_ckpt=self.base_ckpt,
                        attn_ckpt=repo_path,
                        attn_ckpt_version=self.attn_ckpt_version,
                        weight_dtype=self.weight_dtype,
                        use_tf32=self.config["allow_tf32"],
                        device=self.device,
                        skip_safety_check=self.config["skip_safety_check"],
                    )
                except Exception as fallback_exc:
                    self.base_ckpt = primary_ckpt
                    raise RuntimeError(
                        f"Primary base_ckpt '{primary_ckpt}' failed ({primary_exc}); "
                        f"fallback '{FALLBACK_BASE_MODEL}' also failed ({fallback_exc})"
                    ) from primary_exc

            # Enforce uniform device and dtype after accelerate.load_checkpoint_in_model
            if hasattr(self.pipeline, "unet") and self.pipeline.unet is not None:
                self.pipeline.unet.to(self.device, dtype=self.weight_dtype)
            if hasattr(self.pipeline, "vae") and self.pipeline.vae is not None:
                self.pipeline.vae.to(self.device, dtype=self.weight_dtype)

            print(
                f"[CatVTON] Loaded official CatVTONPipeline in {time.time() - start_time:.2f}s",
                file=sys.stderr,
            )
        except ImportError as exc:
            raise RuntimeError(
                f"Official CatVTON `model.pipeline` module not found in PYTHONPATH "
                f"(CATVTON_REPO_PATH={os.getenv('CATVTON_REPO_PATH', '<unset>')}): {exc}"
            )

        # 2. Load Official AutoMasker (DensePose + SCHP)
        if self.load_automasker:
            t_mask_start = time.time()
            try:
                from model.cloth_masker import AutoMasker  # type: ignore
            except Exception as exc:
                cuda_home = os.environ.get("CUDA_HOME") or os.environ.get("CUDA_PATH") or "<unset>"
                torch_cuda = getattr(getattr(torch, "version", None), "cuda", None)
                raise RuntimeError(
                    f"Failed to import AutoMasker (DensePose / SCHP inplace_abn CUDA extension). "
                    f"Verify CUDA_HOME ({cuda_home}) matches torch.version.cuda ({torch_cuda}) "
                    f"and Detectron2/DensePose are installed. Root error: {exc}"
                ) from exc

            densepose_ckpt = os.path.join(repo_path, self.config["densepose_subdir"])
            schp_ckpt = os.path.join(repo_path, self.config["schp_subdir"])
            self.automasker = AutoMasker(
                densepose_ckpt=densepose_ckpt,
                schp_ckpt=schp_ckpt,
                device=self.device,
            )
            print(
                f"[CatVTON] Loaded AutoMasker (DensePose + SCHP) in {time.time() - t_mask_start:.2f}s",
                file=sys.stderr,
            )

    def generate_auto_mask(
        self,
        person_image: Image.Image,
        category: str = "upper_body",
        sleeve_length: str = "auto",
        mask_refinement: str = "fitsync",
        hem_extend_ratio: float = 0.04,
    ) -> Image.Image:
        """
        Generates a cloth-agnostic mask automatically using CatVTON's `AutoMasker` (DensePose + SCHP),
        matching the Google Colab Gradio proof-of-concept (`app.py` lines 163-166), and enforces
        faceless mannequin head protection using DensePose anatomical landmarks.
        """
        if self.automasker is None:
            raise RuntimeError(
                "AutoMasker (DensePose + SCHP) is not initialized. Cannot generate automatic mask."
            )

        cloth_type = map_category_to_automasker_part(category)
        mask_result = self.automasker(person_image, cloth_type)
        if isinstance(mask_result, dict):
            raw_mask = mask_result["mask"]
            densepose_map = mask_result.get("densepose")
        else:
            raw_mask = mask_result
            densepose_map = None

        # Phase 3: replace the official convex-hull mask (long sleeves, pointed hem)
        # with a DensePose-part mask that respects sleeve length and cuts a straight hem.
        self.last_mask_info = {"refinement": "official"}
        if cloth_type == "upper" and mask_refinement == "fitsync":
            raw_mask, info = build_fitsync_upper_mask(
                densepose_map,
                raw_mask,
                sleeve_length=sleeve_length,
                hem_extend_ratio=hem_extend_ratio,
            )
            self.last_mask_info = {"refinement": "fitsync", **info}
            if not info.get("applied"):
                print(
                    f"[CatVTON] FitSync mask refinement skipped ({info.get('reason')}); using official AutoMasker mask.",
                    file=sys.stderr,
                )

        protected_mask = enforce_faceless_mannequin_head_protection(
            raw_mask,
            densepose_mask=densepose_map,
            category=category,
        )
        return validate_mask(protected_mask, target_size=(CANONICAL_WIDTH, CANONICAL_HEIGHT))

    def infer(
        self,
        person_image: Image.Image,
        garment_image: Image.Image,
        mask_image: Image.Image,
        num_inference_steps: int = 50,
        guidance_scale: float = 2.5,
        seed: Optional[int] = 42,
        repaint: bool = True,
    ) -> Image.Image:
        """
        Executes Virtual Try-On inference matching the official CatVTON Gradio `app.py` flow:
          1. Blurs the agnostic mask (`blur_factor=9`).
          2. Runs spatial concatenation diffusion (`CatVTONPipeline`).
          3. Optionally composites with `repaint_result` to guarantee 100% preservation of the
             faceless mannequin head and background outside the blurred mask.
        """
        if self.pipeline is None:
            raise RuntimeError("CatVTON pipeline is not loaded.")

        generator = None
        if seed is not None and seed != -1 and torch is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        if self.device == "cuda" and torch is not None:
            torch.cuda.empty_cache()

        # Apply Gaussian blur to the binary mask matching `app.py` line 167:
        # `mask = mask_processor.blur(mask, blur_factor=9)`
        blurred_mask = blur_agnostic_mask(mask_image, blur_factor=9)

        try:
            result = self.pipeline(
                image=person_image,
                condition_image=garment_image,
                mask=blurred_mask,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                height=CANONICAL_HEIGHT,
                width=CANONICAL_WIDTH,
                generator=generator,
            )
            output_image = result[0] if isinstance(result, (list, tuple)) else result.images[0]

            if repaint:
                output_image = repaint_result(output_image, person_image, blurred_mask)

            return output_image

        except Exception as e:
            if torch is not None and hasattr(torch.cuda, "OutOfMemoryError") and isinstance(e, torch.cuda.OutOfMemoryError):
                torch.cuda.empty_cache()
                raise RuntimeError(
                    f"GPU Out of Memory during CatVTON inference at 768x1024. Details: {str(e)}"
                )
            raise RuntimeError(f"CatVTON inference failed: {str(e)}")
