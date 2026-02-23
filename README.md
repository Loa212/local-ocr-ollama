## Overview

A lightweight, self-hosted web application that provides drag-and-drop document OCR powered by GLM-OCR running locally via Ollama. Users upload images or PDFs through a browser UI and receive structured Markdown output. All processing happens on-device — no cloud, no API keys, no data leaving the machine.

The app ships as a Docker container that handles the web UI, file processing, and PDF conversion. It connects to Ollama running natively on the host machine for GPU-accelerated OCR inference.

## Problem

Running OCR models locally today requires terminal fluency: managing Ollama prompts, converting PDFs to images manually, dealing with context window settings, and stitching multi-page results together. There's no simple local-first UI for "drop a file, get text back."

## Target User

Anyone who needs private, local document parsing without sending files to cloud services. The primary user may not be technical — setup should be copy-pasteable terminal commands and nothing more.

**Give-it-to-a-friend simple:**
```bash
# Step 1: Install Ollama from ollama.com, then:
ollama pull glm-ocr

# Step 2: Run the app
docker run -p 3000:3000 ocr-app

# Step 3: Open http://localhost:3000
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Host Machine (macOS / Windows / Linux)                 │
│                                                         │
│  ┌──────────────────────┐    ┌───────────────────────┐  │
│  │  Docker Container     │    │  Ollama (native)      │  │
│  │                       │    │                       │  │
│  │  Bun HTTP server      │    │  GLM-OCR (0.9B)      │  │
│  │  PDF → PNG (poppler)  │───▶│  localhost:11434      │  │
│  │  Web UI               │    │                       │  │
│  │                       │    │  GPU-accelerated:     │  │
│  │  localhost:3000       │    │  - Metal (macOS)      │  │
│  │                       │    │  - CUDA (Windows)     │  │
│  └──────────────────────┘    │  - CPU fallback       │  │
│                               └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Why separated?**
- Docker on macOS/Windows can't pass through GPU. Ollama must run natively to use Metal or CUDA.
- This also means the user can swap models without rebuilding the container.
- The container is tiny — just Bun + poppler, no ML dependencies.

## Platform Support

| Platform | Ollama GPU | Docker | Notes |
|---|---|---|---|
| macOS (Apple Silicon) | Metal | Docker Desktop | Use `host.docker.internal` to reach Ollama |
| Windows 10/11 | NVIDIA CUDA | Docker Desktop + WSL2 | Use `host.docker.internal` to reach Ollama |
| Linux | NVIDIA CUDA | Docker Engine | Use `--network host` or `host.docker.internal` with Docker 20.10+ |

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** | Fast, native TypeScript, built-in HTTP server and file APIs, small Docker image |
| OCR Model | **GLM-OCR** via Ollama | 0.9B params, #1 on OmniDocBench V1.5 (94.62), runs on 8GB+ RAM |
| PDF → Image | **poppler** (`pdftoppm`) | Clean CLI, DPI control, one image per page, available in Alpine packages |
| Frontend | **Single HTML file** | Inline CSS/JS, no build step, served by Bun |
| Container | **Docker** | Alpine-based, minimal image (~80MB with Bun + poppler) |

## System Requirements

- **Ollama** installed natively on the host ([ollama.com](https://ollama.com))
- **GLM-OCR** model pulled: `ollama pull glm-ocr`
- **Docker Desktop** (macOS/Windows) or Docker Engine (Linux)
- 8GB+ RAM available for the model

---

## Setup Guide (for the friend)

### macOS

```bash
# 1. Install Ollama
brew install ollama
# Or download from https://ollama.com

# 2. Start Ollama and pull the model
ollama serve &
ollama pull glm-ocr

# 3. Run the OCR app
docker run -p 3000:3000 -e OLLAMA_HOST=http://host.docker.internal:11434 ocr-app

# 4. Open http://localhost:3000
```

### Windows

```powershell
# 1. Install Ollama from https://ollama.com (run the installer)

# 2. Open a terminal and pull the model
ollama pull glm-ocr

# 3. Run the OCR app (Docker Desktop must be running)
docker run -p 3000:3000 -e OLLAMA_HOST=http://host.docker.internal:11434 ocr-app

# 4. Open http://localhost:3000
```

### Linux

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull the model
ollama pull glm-ocr

# 3. Run the OCR app
docker run -p 3000:3000 --network host ocr-app
# On Linux with --network host, OLLAMA_HOST defaults to http://localhost:11434
```

---

## Features

### F1: File Upload with Drag & Drop

- Drop zone accepts `.jpg`, `.jpeg`, `.png`, `.webp`, `.pdf`
- Click-to-browse fallback
- Multiple file selection supported
- Visual feedback on drag-over (border highlight, icon change)
- File type validation on the client side before upload
- Display file name, type badge, and thumbnail preview for images

### F2: PDF to Image Conversion

- Server-side conversion using `pdftoppm` (bundled in the Docker image)
- Render at **200 DPI** (standard for OCR models)
- Output as PNG
- Multi-page PDFs produce one image per page
- Temp images stored in `/tmp/ocr-app/` inside the container and cleaned up after processing
- Return page count to the UI before OCR begins so progress can be shown

### F3: OCR via Ollama API

- Use Ollama's HTTP API (host configurable via `OLLAMA_HOST` env var)
- Default: `http://host.docker.internal:11434` (works on macOS and Windows Docker Desktop)
- Model: `glm-ocr`
- Set `num_ctx: 16384` in every request (required for image processing)
- Prompt: send image as base64 with the message `"Convert this page to markdown."`
- `stream: false` — wait for complete response per page

**Request shape:**
```json
{
  "model": "glm-ocr",
  "messages": [
    {
      "role": "user",
      "content": "Convert this page to markdown.",
      "images": ["<base64-encoded-image>"]
    }
  ],
  "options": {
    "num_ctx": 16384
  },
  "stream": false
}
```

### F4: Batch Processing

- Queue multiple files for sequential processing
- Each file shows its own status: queued → processing → done / error
- For multi-page PDFs, show per-page progress (e.g., "Page 3 of 12")
- Results accumulate as each file completes — don't block on the whole batch
- Each file's result is independently viewable and copyable

### F5: Markdown Output Display

- Render OCR output as both raw Markdown (in a code block) and rendered HTML preview
- Toggle between raw and rendered views
- "Copy to clipboard" button for the raw Markdown
- "Download as .md" button per file
- "Download all" button that concatenates results with `---` separators and filename headers
- For multi-page PDFs, pages are separated by `---` with a `<!-- Page N -->` comment

### F6: Progress Indication

- Per-file progress bar or spinner
- States: `queued` → `converting` (PDF only) → `processing` → `done` / `error`
- Show elapsed time per file
- For PDFs: show current page number during OCR
- Global progress: "3 of 7 files complete"

---

## Configuration

All configuration via environment variables passed to `docker run`:

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `glm-ocr` | Model to use for OCR |
| `PORT` | `3000` | Port the web UI listens on |
| `PDF_DPI` | `200` | DPI for PDF to image conversion |
| `OCR_TIMEOUT` | `120` | Timeout in seconds per page |
| `MAX_FILE_SIZE` | `50` | Max upload size in MB |
| `NUM_CTX` | `16384` | Context window size for the model |

---

## API Design

All endpoints served by the Bun HTTP server.

### `GET /`
Serves the single-page HTML/CSS/JS frontend.

### `POST /api/ocr`
Accepts `multipart/form-data` with one or more files.

**Response:** Server-Sent Events (SSE) stream for real-time progress updates.

```
event: file-start
data: {"fileId": "abc123", "fileName": "invoice.pdf", "pages": 3}

event: page-progress
data: {"fileId": "abc123", "page": 1, "totalPages": 3, "status": "processing"}

event: page-done
data: {"fileId": "abc123", "page": 1, "markdown": "# Invoice\n\n..."}

event: file-done
data: {"fileId": "abc123", "markdown": "# Invoice\n\n...\n\n---\n\n## Line Items\n\n..."}

event: error
data: {"fileId": "abc123", "error": "Ollama not reachable"}

event: batch-done
data: {"totalFiles": 3, "successful": 2, "failed": 1}
```

### `GET /api/health`
Returns Ollama connectivity, model availability, and poppler status.

```json
{
  "app": true,
  "ollama": true,
  "model": "glm-ocr",
  "modelReady": true,
  "poppler": true,
  "ollamaHost": "http://host.docker.internal:11434"
}
```

The frontend polls this on load and shows a status banner if anything is missing, with copy-pasteable fix commands for the user's platform.

---

## Docker

### Dockerfile

```dockerfile
FROM oven/bun:alpine

RUN apk add --no-cache poppler-utils

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .

ENV PORT=3000
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV OLLAMA_MODEL=glm-ocr

EXPOSE 3000
CMD ["bun", "run", "server.ts"]
```

### docker-compose.yml (optional convenience)

```yaml
services:
  ocr-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OLLAMA_HOST=http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

The `extra_hosts` line ensures `host.docker.internal` resolves on Linux, where it's not available by default.

---

## Project Structure

```
ocr-app/
├── server.ts          # Bun HTTP server, routes, SSE
├── ocr.ts             # Ollama API wrapper (send image, parse response)
├── pdf.ts             # PDF → PNG conversion via pdftoppm subprocess
├── index.html         # Single-file frontend (HTML + inline CSS + JS)
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md          # Setup guide (the "give to a friend" doc)
```

No framework, no bundler, minimal dependencies. The HTML file is self-contained.

---

## UI Layout

```
┌──────────────────────────────────────────────────────┐
│  🔍 OCR App                              [Health: ●] │
├──────────────────────────────────────────────────────┤
│                                                      │
│     ┌──────────────────────────────────────┐         │
│     │                                      │         │
│     │    Drop files here or click to       │         │
│     │    browse                             │         │
│     │                                      │         │
│     │    .jpg .png .webp .pdf              │         │
│     │                                      │         │
│     └──────────────────────────────────────┘         │
│                                                      │
│  ┌─ Files ─────────────────────────────────────────┐ │
│  │  📄 invoice.pdf          3 pages    ✅ Done     │ │
│  │  🖼️ receipt.jpg          1 page     ⏳ OCR...   │ │
│  │  📄 contract.pdf         12 pages   ⏸️ Queued   │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ Result: invoice.pdf ───────────────────────────┐ │
│  │  [Raw] [Preview]              [Copy] [Download] │ │
│  │                                                  │ │
│  │  # Invoice                                      │ │
│  │                                                  │ │
│  │  **Invoice Number:** INV-2024-0042              │ │
│  │  **Date:** February 23, 2026                    │ │
│  │  ...                                            │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│                              [Download All (.md)]    │
└──────────────────────────────────────────────────────┘
```

---

## Error Handling

| Condition | Behavior |
|---|---|
| Ollama not reachable | Health indicator red. Upload disabled. Show platform-specific instructions to start Ollama |
| GLM-OCR not pulled | Health indicator yellow. Show: `ollama pull glm-ocr` |
| Ollama timeout (>120s per page) | Mark page as failed, continue to next page/file |
| Model repetition loop (>10KB repeated content) | Detect repetition server-side, truncate, mark as partial with warning |
| Invalid file type | Reject on client side before upload |
| File too large | Reject with message showing configured max size |
| Empty OCR result | Show warning: "No text detected" with suggestions (image quality, content type) |
| Docker can't reach host | Health check fails. Show troubleshooting: check Ollama is running, firewall, `host.docker.internal` resolution |

---

## README.md (ships with the repo)

The README should be the entire setup experience. It should include:

1. **One-line description** of what the app does
2. **Prerequisites**: Ollama + Docker, nothing else
3. **Quick start** for each platform (macOS, Windows, Linux) — 3 commands max
4. **Screenshot** of the UI
5. **Configuration** table (env vars)
6. **Troubleshooting** section covering the common errors above
7. **"How it works"** one-paragraph explanation of the architecture

No "contributing" section, no license boilerplate at the top, no badges. Just "here's how to use it."

---

## Future Considerations (Out of Scope for V1)

- **Model switching:** dropdown to pick between `glm-ocr`, `deepseek-ocr`, or other Ollama vision models
- **Language hints:** prompt customization for non-English/Chinese documents
- **Output format toggle:** Markdown vs plain text vs JSON
- **Side-by-side view:** original image next to OCR output for verification
- **History:** persist past results in a Docker volume (SQLite)
- **API-only mode:** headless usage for scripting (`curl -F file=@doc.pdf localhost:3000/api/ocr`)
- **Pre-built Docker image:** publish to GitHub Container Registry so users skip the build step entirely
- **Ollama bundled mode:** optional Docker Compose that runs Ollama in a sidecar container (CPU-only, for users who can't install Ollama natively)
