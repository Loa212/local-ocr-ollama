#!/bin/sh
set -e

CONFIG=/app/config.yaml

# Parse OLLAMA_HOST (e.g. "http://host.docker.internal:11434") into components
if [ -n "$OLLAMA_HOST" ]; then
  SCHEME="${OLLAMA_HOST%%://*}"
  HOST_PORT="${OLLAMA_HOST#*://}"
  HOST_PORT="${HOST_PORT%/}"
  HOST="${HOST_PORT%%:*}"
  PORT="${HOST_PORT##*:}"
  # If no port was present, HOST_PORT == PORT (no colon found)
  if [ "$PORT" = "$HOST" ]; then
    PORT=11434
  fi

  sed -i "s|api_host:.*|api_host: ${HOST}|" "$CONFIG"
  sed -i "s|api_port:.*|api_port: ${PORT}|" "$CONFIG"
  sed -i "s|api_scheme:.*|api_scheme: ${SCHEME}|" "$CONFIG"
fi

if [ -n "$OLLAMA_MODEL" ]; then
  sed -i "s|^    model:.*|    model: ${OLLAMA_MODEL}|" "$CONFIG"
fi

if [ "$ENABLE_LAYOUT" = "false" ]; then
  sed -i "s|enable_layout:.*|enable_layout: false|" "$CONFIG"
fi

exec python -m glmocr.server --config "$CONFIG"
