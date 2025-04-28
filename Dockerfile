FROM python:3.13-slim

WORKDIR /app

ENV ALCOVES_MEDIA_PATH=/data/media
ENV ALCOVES_DB_PATH=/data/alcoves.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip && pip install uv

COPY pyproject.toml uv.lock ./

# --no-dev
RUN uv sync --locked

COPY . /app/

EXPOSE 8000
CMD ["uv", "run", "manage.py", "runserver", "0.0.0.0:8000"]
