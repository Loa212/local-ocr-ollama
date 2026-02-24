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

export function normalizeHost(host: string): string {
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
    const response = await fetch(`${normalizeHost(options.ollamaHost)}/api/chat`, {
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
            content: "Text Recognition:",
            images: [imageBase64]
          }
        ],
        options: {
          num_ctx: options.numCtx,
          temperature: 0.01
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

// ---------------------------------------------------------------------------
// GLM-OCR SDK sidecar backend
// ---------------------------------------------------------------------------

export type GlmOcrSdkOptions = {
  imagePath: string;
  glmOcrHost: string;
  timeoutMs: number;
};

type GlmOcrJsonBlock = {
  index: number;
  label: string;
  content: string;
  bbox_2d: number[] | null;
};

type GlmOcrParseResponse = {
  json_result?: GlmOcrJsonBlock[][][];
  markdown_result?: string;
};

export async function ocrImageViaGlmOcrSdk(options: GlmOcrSdkOptions): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(`GLM-OCR SDK request timed out after ${options.timeoutMs}ms`);
  }, options.timeoutMs);

  try {
    const url = `${normalizeHost(options.glmOcrHost)}/glmocr/parse`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ images: [options.imagePath] })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new OcrError(`GLM-OCR SDK request failed (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as GlmOcrParseResponse;

    const markdown = payload.markdown_result?.trim();
    if (markdown) {
      return markdown;
    }

    if (payload.json_result && payload.json_result.length > 0) {
      return payload.json_result
        .flat(2)
        .map((block) => block.content)
        .join("\n\n");
    }

    throw new OcrError("Empty result returned by GLM-OCR SDK");
  } catch (error) {
    if (error instanceof OcrError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OcrError(`GLM-OCR SDK request timed out after ${options.timeoutMs}ms`, error);
    }
    throw new OcrError(`Failed to reach GLM-OCR SDK at ${options.glmOcrHost}`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}
