# syntax=docker/dockerfile:1
# ============================================================================
# NEXUS — Python computer-vision detector (FastAPI + YOLO/OpenCV)
# Build context: apps/detector
#   docker build -t nexus-detector ./apps/detector
#
# The four demo clips are large and are mounted as a read-only volume at
# /app/clips (see docker-compose.yml) rather than baked into the image.
# The YOLO weights (yolov8n.pt) ARE baked in so there is no runtime download.
# ============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Run the single-owner background detection worker (see app/worker.py).
    DETECTOR_WORKER=1 \
    # Reached by the Node API as http://detector:8099 on the compose network.
    DETECTOR_HOST=0.0.0.0 \
    DETECTOR_PORT=8099

# OpenCV runtime libraries (even the headless wheel needs libGL/glib at import).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching (torch is the heavy layer
# and rarely changes). Install the CPU-only PyTorch build explicitly so pip does
# NOT pull the multi-GB CUDA/NVIDIA wheels (this is a CPU deployment); ultralytics
# then reuses the already-satisfied torch instead of fetching the CUDA build.
COPY requirements.txt ./
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements.txt

# Application code.
COPY app ./app

# Pre-fetch the YOLO weights at build time so there is no runtime download.
# (yolov8n.pt is git-ignored, so it cannot be COPYed from a fresh clone.)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Clips are provided via a bind/volume mount at runtime.
RUN mkdir -p clips

EXPOSE 8099
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8099"]
