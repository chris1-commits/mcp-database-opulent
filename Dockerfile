# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=8000

# Install package with sources present so setuptools can find the gateway package.
COPY pyproject.toml setup.cfg ./
COPY gateway ./gateway
RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "gateway.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
