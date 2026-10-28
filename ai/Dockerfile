FROM python:3.11-slim
WORKDIR /app
ENV HF_HOME=/app/hf PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

RUN python -c "from transformers import CLIPModel, CLIPProcessor; n='patrickjohncyh/fashion-clip'; CLIPModel.from_pretrained(n); CLIPProcessor.from_pretrained(n)"

COPY service/ .
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}