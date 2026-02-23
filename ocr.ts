import { readFile } from "node:fs/promises";

export type OcrOptions = {
  imagePath: string;
  ollamaHost: string;
  model: string;
  numCtx: number;
  timeoutMs: number;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export class OcrError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OcrError";
    this.cause = cause;
  }
}

function normalizeOllamaHost(host: string): string {
  return host.endsWith("/") ? host.slice(0, -1) : host;
}

export async function ocrImageToMarkdown(options: OcrOptions): Promise<string> {
  const imageBuffer = await readFile(options.imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(`OCR request timed out after ${options.timeoutMs}ms`);
  }, options.timeoutMs);

  try {
    const response = await fetch(`${normalizeOllamaHost(options.ollamaHost)}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: "user",
            content: "Convert this page to markdown.",
            images: [imageBase64]
          }
        ],
        options: {
          num_ctx: options.numCtx
        },
        stream: false
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new OcrError(`Ollama request failed (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    const content = payload.message?.content?.trim();

    if (!content) {
      throw new OcrError("Empty OCR result returned by Ollama");
    }

    return content;
  } catch (error) {
    if (error instanceof OcrError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new OcrError(`OCR request timed out after ${options.timeoutMs}ms`, error);
    }

    throw new OcrError(`Failed to reach Ollama at ${options.ollamaHost}`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}
