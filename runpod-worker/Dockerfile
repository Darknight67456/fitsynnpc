# FitSync Module 4 — CatVTON RunPod Serverless Worker Dockerfile (Phase 2: AutoMasker Enabled)
# Base image: Official NVIDIA CUDA 12.1.1 Devel (includes nvcc for Detectron2/DensePose & SCHP inplace_abn CUDA extension)
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

LABEL maintainer="FitSync AI Engineering"
LABEL description="RunPod Serverless Worker for CatVTON Virtual Try-On with Automatic Masking (PyTorch 2.4.0 + CUDA 12.1)"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FORCE_CUDA="1" \
    TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0" \
    TORCH_EXTENSIONS_DIR=/app/.torch_extensions \
    HF_HOME=/runpod-volume/huggingface \
    BASE_MODEL_PATH="booksforcharlie/stable-diffusion-inpainting" \
    CATVTON_MODEL_PATH="zhengchong/CatVTON"

# 1. Install system build tools (g++, ninja) and media libraries required by Detectron2, DensePose, and SCHP
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ninja-build \
    python3.10 \
    python3.10-dev \
    python3.10-venv \
    python3-pip \
    git \
    curl \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Set python3 alias
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1

WORKDIR /app

# 2. Copy and install pinned Python dependencies (PyTorch 2.4.0+cu121 & setuptools<70 for Detectron2 pkg_resources)
COPY requirements.txt /app/requirements.txt
RUN pip3 install --upgrade pip "setuptools<70.0.0" wheel && \
    pip3 install -r /app/requirements.txt

# 3. Install Detectron2 & DensePose from a single clone (avoiding double compilation in DensePose setup.py)
RUN git clone --depth 1 https://github.com/facebookresearch/detectron2.git /tmp/detectron2 && \
    pip3 install --no-build-isolation /tmp/detectron2 && \
    pip3 install --no-build-isolation --no-deps /tmp/detectron2/projects/DensePose && \
    rm -rf /tmp/detectron2

# 4. Clone official CatVTON repository, preserve model/, utils.py, and resource/, and pre-compile SCHP inplace_abn
RUN git clone --depth 1 https://github.com/Zheng-Chong/CatVTON.git /app/CatVTON && \
    mv /app/CatVTON/model /app/model && \
    mv /app/CatVTON/utils.py /app/utils.py && \
    mv /app/CatVTON/resource /app/resource && \
    rm -rf /app/CatVTON && \
    mkdir -p /app/.torch_extensions /app/densepose_/tmp && \
    if [ -d /app/model/SCHP/modules/src ]; then python3 -c "from torch.utils.cpp_extension import load; import os; s='/app/model/SCHP/modules/src'; load(name='inplace_abn', extra_cflags=['-O3'], sources=[os.path.join(s, f) for f in ['inplace_abn.cpp','inplace_abn_cpu.cpp','inplace_abn_cuda.cu','inplace_abn_cuda_half.cu']], extra_cuda_cflags=['--expt-extended-lambda'])"; fi

# 5. Copy isolated FitSync worker modules and tests
COPY preprocessor.py /app/preprocessor.py
COPY fitsync_mask.py /app/fitsync_mask.py
COPY catvton_pipeline.py /app/catvton_pipeline.py
COPY handler.py /app/handler.py
COPY test_input.json /app/test_input.json
COPY test_worker.py /app/test_worker.py
COPY gpu_smoke_test.py /app/gpu_smoke_test.py

# 6. RunPod Serverless entrypoint
CMD ["python3", "-u", "handler.py"]
