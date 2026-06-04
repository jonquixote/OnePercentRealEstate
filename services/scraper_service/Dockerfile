FROM python:3.11-slim

WORKDIR /app

# psycopg2-binary is a self-contained wheel that bundles libpq and its
# own compiled bindings, so no libpq-dev / build-essential toolchain is
# needed in production. Saves ~200MB vs. the old Dockerfile.

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
