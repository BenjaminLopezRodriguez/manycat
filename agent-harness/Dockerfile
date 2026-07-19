FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY programming_agent ./programming_agent

RUN pip install --no-cache-dir -e "."

ENV WORKSPACE_ROOT=/workspace
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "programming_agent.server:app", "--host", "0.0.0.0", "--port", "8000"]
