# FastAPI shim around the legacy rent_estimator_v2 triangulation.
# Build context is repo root so we can copy both services/rent_estimator_v2.py
# and services/ml/ into a single image — the shim's `_PARENT` sys.path
# hack assumes they sit at the same directory.
FROM python:3.11-slim

# tini gives us PID 1 + signal forwarding for graceful shutdown when
# docker stops the container (matters because the FastAPI workers are
# long-running and we want them to drain in-flight requests).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini build-essential libpq-dev wget \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python deps first so the layer cache survives source-only changes.
COPY services/ml/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Legacy estimator + its ML helper package come along for the ride. We
# DON'T copy the rest of services/ (scraper, schedulers, etc.) — keeps
# the image small and the surface area honest.
COPY services/rent_estimator_v2.py /app/rent_estimator_v2.py
COPY services/ml_rent_estimator /app/ml_rent_estimator
COPY services/ml /app/services/ml

# So `python -m services.ml.main` works AND so the shim can find
# rent_estimator_v2 next to it via sys.path[0]='/app'.
ENV PYTHONPATH=/app
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "services.ml.main:app", "--host", "0.0.0.0", "--port", "8000"]
