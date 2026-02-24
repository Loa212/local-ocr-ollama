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

exec python -c "
from glmocr.layout.layout_detector import PPDocLayoutDetector
from transformers import AutoConfig

_orig_init = PPDocLayoutDetector.__init__
def _patched_init(self, config):
    if not hasattr(config, 'id2label'):
        hf_cfg = AutoConfig.from_pretrained(config.model_dir)
        object.__setattr__(config, 'id2label', hf_cfg.id2label)
    _orig_init(self, config)
PPDocLayoutDetector.__init__ = _patched_init

from glmocr.server import main
main()
" --config "$CONFIG"
