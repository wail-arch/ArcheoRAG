FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY archeoqa/backend/requirements.txt /tmp/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && python -m pip install -r /tmp/requirements.txt

COPY archeoqa/backend /app/archeoqa/backend
RUN mkdir -p \
    /app/.cache/huggingface \
    /app/archeoqa/data/papers \
    /app/archeoqa/data/indexes \
    /app/archeoqa/data/analysis

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "archeoqa.backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
