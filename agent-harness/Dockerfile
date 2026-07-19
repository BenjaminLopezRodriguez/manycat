FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    # Playwright Chromium deps
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY programming_agent ./programming_agent

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir -e "." \
  && playwright install chromium

ENV WORKSPACE_ROOT=/workspace
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "programming_agent.server:app", "--host", "0.0.0.0", "--port", "8000"]
