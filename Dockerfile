# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml setup.cfg ./
COPY gateway ./gateway
RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["python", "-m", "gateway.server"]
