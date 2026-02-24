import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convertPdfToPngPages } from "./pdf.ts";
import { ocrImageToMarkdown } from "./ocr.ts";
import * as logger from "./logger.ts";

type HealthStatus = {
  app: boolean;
  ollama: boolean;
  model: string;
  modelReady: boolean;
  poppler: boolean;
  ollamaHost: string;
};

type SseEventName =
  | "file-start"
  | "page-progress"
  | "page-done"
  | "file-done"
  | "error"
  | "batch-done";

type AppConfig = {
  port: number;
  ollamaHost: string;
  ollamaModel: string;
  pdfDpi: number;
  ocrTimeoutMs: number;
  maxFileSizeBytes: number;
  numCtx: number;
};

const config: AppConfig = {
  port: Number.parseInt(Bun.env.PORT ?? "3000", 10),
  ollamaHost: Bun.env.OLLAMA_HOST ?? "http://host.docker.internal:11434",
  ollamaModel: Bun.env.OLLAMA_MODEL ?? "glm-ocr",
  pdfDpi: Number.parseInt(Bun.env.PDF_DPI ?? "300", 10),
  ocrTimeoutMs: Number.parseInt(Bun.env.OCR_TIMEOUT ?? "120", 10) * 1000,
  maxFileSizeBytes: Number.parseInt(Bun.env.MAX_FILE_SIZE ?? "50", 10) * 1024 * 1024,
  numCtx: Number.parseInt(Bun.env.NUM_CTX ?? "16384", 10)
};

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const tempRoot = path.join(os.tmpdir(), "ocr-app");
const indexPath = new URL("./index.html", import.meta.url);

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

function toSseEvent(event: SseEventName, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isRepetitiveOutput(markdown: string): boolean {
  if (markdown.length < 10_000) {
    return false;
  }

  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 25);

  if (lines.length < 5) {
    return false;
  }

  const seen = new Map<string, number>();
  for (const line of lines) {
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    if (count >= 20) {
      return true;
    }
  }

  return false;
}

async function checkPoppler(): Promise<boolean> {
  try {
    const process = Bun.spawn({
      cmd: ["pdftoppm", "-v"],
      stdout: "pipe",
      stderr: "pipe"
    });
    const exitCode = await process.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

function normalizeHost(host: string): string {
  return host.endsWith("/") ? host.slice(0, -1) : host;
}

async function checkOllamaAndModel(): Promise<Pick<HealthStatus, "ollama" | "modelReady">> {
  try {
    const response = await fetch(`${normalizeHost(config.ollamaHost)}/api/tags`, {
      method: "GET"
    });

    if (!response.ok) {
      return { ollama: false, modelReady: false };
    }

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };

    const modelReady =
      payload.models?.some((model) => {
        const candidate = model.name ?? model.model ?? "";
        return candidate === config.ollamaModel || candidate.startsWith(`${config.ollamaModel}:`);
      }) ?? false;

    return { ollama: true, modelReady };
  } catch {
    return { ollama: false, modelReady: false };
  }
}

async function buildHealthStatus(): Promise<HealthStatus> {
  const [poppler, ollamaInfo] = await Promise.all([checkPoppler(), checkOllamaAndModel()]);

  return {
    app: true,
    poppler,
    ollama: ollamaInfo.ollama,
    model: config.ollamaModel,
    modelReady: ollamaInfo.modelReady,
    ollamaHost: config.ollamaHost
  };
}

async function streamOcrResults(
  files: File[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: SseEventName, data: Record<string, unknown>) => {
    if (signal.aborted) {
      return;
    }
    controller.enqueue(encoder.encode(toSseEvent(event, data)));
  };

  let successful = 0;
  let failed = 0;

  logger.log("OCR batch started", { fileCount: files.length });
  await mkdir(tempRoot, { recursive: true });

  for (const file of files) {
    if (signal.aborted) {
      break;
    }

    const fileId = crypto.randomUUID();
    const startedAt = Date.now();
    const fileName = file.name || "upload";
    const extension = getExtension(fileName);

    if (!allowedExtensions.has(extension)) {
      failed += 1;
      logger.warn("Rejected file: unsupported type", { fileId, fileName, extension });
      send("error", {
        fileId,
        fileName,
        error: "Unsupported file type. Allowed: .jpg, .jpeg, .png, .webp, .pdf"
      });
      continue;
    }

    if (file.size > config.maxFileSizeBytes) {
      failed += 1;
      logger.warn("Rejected file: exceeds max size", { fileId, fileName, sizeBytes: file.size });
      send("error", {
        fileId,
        fileName,
        error: `File exceeds max size (${Math.round(config.maxFileSizeBytes / 1024 / 1024)}MB)`
      });
      continue;
    }

    const workDir = await mkdtemp(path.join(tempRoot, `${fileId}-`));

    try {
      const safeName = sanitizeFileName(fileName);
      const uploadPath = path.join(workDir, safeName);
      await Bun.write(uploadPath, await file.arrayBuffer());

      let pagePaths: string[] = [];
      if (extension === ".pdf") {
        pagePaths = await convertPdfToPngPages(uploadPath, workDir, config.pdfDpi);
      } else if (imageExtensions.has(extension)) {
        pagePaths = [uploadPath];
      }

      send("file-start", {
        fileId,
        fileName,
        pages: pagePaths.length
      });

      const pageResults: string[] = [];

      for (let pageIndex = 0; pageIndex < pagePaths.length; pageIndex += 1) {
        const pageNumber = pageIndex + 1;

        send("page-progress", {
          fileId,
          page: pageNumber,
          totalPages: pagePaths.length,
          status: "processing"
        });

        try {
          let markdown = await ocrImageToMarkdown({
            imagePath: pagePaths[pageIndex],
            ollamaHost: config.ollamaHost,
            model: config.ollamaModel,
            timeoutMs: config.ocrTimeoutMs,
            numCtx: config.numCtx
          });

          if (isRepetitiveOutput(markdown)) {
            markdown = `${markdown.slice(0, 10_000)}\n\n[Truncated: repetitive OCR output detected]`;
          }

          pageResults.push(markdown);

          send("page-done", {
            fileId,
            page: pageNumber,
            markdown
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown OCR error";
          logger.error("OCR failed for page", err, { fileId, fileName, page: pageNumber });
          send("error", {
            fileId,
            fileName,
            page: pageNumber,
            error: message
          });
        }
      }

      if (pageResults.length === 0) {
        failed += 1;
        logger.warn("No pages processed successfully", { fileId, fileName });
      } else {
        successful += 1;
        const finalMarkdown =
          pageResults.length === 1
            ? pageResults[0]
            : pageResults
                .map((pageText, index) => `<!-- Page ${index + 1} -->\n\n${pageText}`)
                .join("\n\n---\n\n");

        send("file-done", {
          fileId,
          fileName,
          markdown: finalMarkdown,
          elapsedMs: Date.now() - startedAt
        });
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "Unknown processing error";
      logger.error("Unhandled error processing file", err, { fileId, fileName });
      send("error", {
        fileId,
        fileName,
        error: message
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  logger.log("OCR batch done", { total: files.length, successful, failed });
  send("batch-done", {
    totalFiles: files.length,
    successful,
    failed
  });

  if (!signal.aborted) {
    try {
      controller.close();
    } catch {
      // Client already disconnected
    }
  }
}

function collectFiles(formData: FormData): File[] {
  const files: File[] = [];
  for (const [, value] of formData.entries()) {
    const candidate = value as unknown as {
      size?: number;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
    if (typeof candidate.arrayBuffer === "function" && typeof candidate.size === "number" && candidate.size > 0) {
      files.push(value as unknown as File);
    }
  }
  return files;
}

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", err);
  process.exit(1);
});

const server = Bun.serve({
  port: config.port,
  idleTimeout: 255,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(Bun.file(indexPath), {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      const health = await buildHealthStatus();
      return Response.json(health);
    }

    if (request.method === "POST" && url.pathname === "/api/ocr") {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch (err) {
        logger.warn("Failed to parse multipart form data", { url: url.pathname });
        logger.error("Form parse error", err);
        return new Response("Expected multipart/form-data", { status: 400 });
      }

      const files = collectFiles(formData);
      if (files.length === 0) {
        logger.warn("OCR request received with no valid files");
        return new Response("No files uploaded", { status: 400 });
      }

      const abortController = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void streamOcrResults(files, controller, abortController.signal);
        },
        cancel() {
          abortController.abort();
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    }

    logger.warn("Route not found", { method: request.method, path: url.pathname });
    return new Response("Not found", { status: 404 });
  }
});

logger.log(`OCR app listening on http://localhost:${server.port}`, {
  ollamaHost: config.ollamaHost,
  ollamaModel: config.ollamaModel,
  pdfDpi: config.pdfDpi,
  ocrTimeoutMs: config.ocrTimeoutMs,
  maxFileSizeMb: Math.round(config.maxFileSizeBytes / 1024 / 1024),
  numCtx: config.numCtx
});
