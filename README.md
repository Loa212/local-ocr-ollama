# Local OCR with Ollama + Docker

Drag-and-drop OCR web app that runs fully local: upload images/PDFs in the browser, get Markdown back, with inference powered by Ollama (`glm-ocr`) on your own machine.

## How It Works

- App server runs in Docker on port `3000`
- Ollama runs natively on your host on port `11434`
- Docker container sends OCR requests to Ollama over `OLLAMA_HOST`
- PDFs are converted to PNG pages with `pdftoppm` inside the container

## Requirements

- Ollama installed on host
- `glm-ocr` model pulled in Ollama
- Docker Desktop (macOS/Windows) or Docker Engine (Linux)
- 8GB+ RAM recommended

## One-Shot Quick Start

From this repo root:

```bash
# 1) Pull model in Ollama (host terminal)
ollama pull glm-ocr

# 2) Create local env file
cp .env.example .env

# 3) Install deps + build + start
make install
make build
make up

# Stop later:
make down
```

Open `http://localhost:3000`.

## Make Commands

```bash
make help     # Recap commands
make install  # bun install + create .env from .env.example if missing
make build    # docker build + docker compose build
make dev      # run locally with bun
make up       # docker compose up -d
make down     # docker compose down
```

Edit `.env` to override defaults (model, host, port, limits).

---

## Install + Setup by OS

## macOS

### Install Ollama

Option A (Homebrew):

```bash
brew install ollama
```

Option B: install from `https://ollama.com/download`.

### Start Ollama + model

```bash
ollama serve
# in another terminal
ollama pull glm-ocr
```

Tip: after first install on macOS, Ollama may also run as a background app. You can still use `ollama pull glm-ocr` directly.

### Install Docker

- Install Docker Desktop from `https://www.docker.com/products/docker-desktop/`
- Open Docker Desktop and wait until it says it is running

### Build + run this app

```bash
docker build -t ocr-app .
docker run --rm -p 3000:3000 -e OLLAMA_HOST=http://host.docker.internal:11434 ocr-app
```

Open `http://localhost:3000`.

---

## Windows 10/11

### Install Ollama

- Download installer from `https://ollama.com/download`
- Run installer

### Start Ollama + model (PowerShell)

```powershell
ollama pull glm-ocr
```

If Ollama service is not running, launch the Ollama app from Start menu first.

### Install Docker

- Install Docker Desktop from `https://www.docker.com/products/docker-desktop/`
- During install, enable WSL2 integration if prompted
- Start Docker Desktop

### Build + run this app (PowerShell)

```powershell
docker build -t ocr-app .
docker run --rm -p 3000:3000 -e OLLAMA_HOST=http://host.docker.internal:11434 ocr-app
```

Open `http://localhost:3000`.

---

## Linux

Ollama supports Linux. Docker + Ollama setup is fully supported.

### Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Start Ollama + model

```bash
ollama serve
# in another terminal
ollama pull glm-ocr
```

### Install Docker Engine

Use Docker’s official docs for your distro:

- Ubuntu/Debian: `https://docs.docker.com/engine/install/ubuntu/`
- Fedora: `https://docs.docker.com/engine/install/fedora/`
- Arch: `https://wiki.archlinux.org/title/Docker`

After install:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out and back in after group change
```

### Build + run this app

```bash
docker build -t ocr-app .
docker run --rm -p 3000:3000 --network host -e OLLAMA_HOST=http://127.0.0.1:11434 ocr-app
```

Open `http://localhost:3000`.

---

## Dev Run (without Docker)

If you want to run the app server directly on host:

```bash
bun install
bun run dev
```

Then open `http://localhost:3000`.

Notes:
- `pdftoppm` must be installed on host for PDF support (Docker image already includes it)
- macOS: `brew install poppler`
- Ubuntu/Debian: `sudo apt-get install poppler-utils`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `glm-ocr` | Model name |
| `PORT` | `3000` | App port |
| `PDF_DPI` | `200` | PDF render DPI |
| `OCR_TIMEOUT` | `120` | Per-page timeout (seconds) |
| `MAX_FILE_SIZE` | `50` | Max file size in MB |
| `NUM_CTX` | `16384` | `num_ctx` sent to Ollama |

## API

- `GET /` UI
- `GET /api/health` checks app/Ollama/model/poppler
- `POST /api/ocr` multipart upload + SSE stream (`file-start`, `page-progress`, `page-done`, `file-done`, `error`, `batch-done`)

## Troubleshooting

### `Ollama not reachable`

- Confirm Ollama is running (`ollama list` should work)
- Confirm host URL is correct:
  - macOS/Windows Docker Desktop: `http://host.docker.internal:11434`
  - Linux with `--network host`: `http://127.0.0.1:11434`

### `Model missing`

```bash
ollama pull glm-ocr
```

### `PDF conversion failed`

- Docker mode: rebuild image (`docker build -t ocr-app .`) to ensure `poppler-utils` exists
- Host mode: install poppler (`pdftoppm` must be in PATH)

### Slow OCR

- First run is slower due model warm-up
- Use GPU-backed Ollama where available (Metal on macOS, CUDA on supported Linux/Windows)
