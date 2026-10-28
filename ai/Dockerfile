# For Google Cloud Run. Cloud Run tells the program which port to use in $PORT.
FROM python:3.11-slim
WORKDIR /app
ENV HF_HOME=/app/hf PYTHONUNBUFFERED=1

COPY requirements.txt .
# The small CPU-only PyTorch, because there is no graphics card.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# Download the AI model while building, so the service starts fast instead of downloading it every cold start.
RUN python -c "from transformers import CLIPModel, CLIPProcessor; n='patrickjohncyh/fashion-clip'; CLIPModel.from_pretrained(n); CLIPProcessor.from_pretrained(n)"
RUN python -c "from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor; n='mattmdjaga/segformer_b2_clothes'; AutoModelForSemanticSegmentation.from_pretrained(n); SegformerImageProcessor.from_pretrained(n)"

COPY service/ .
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
