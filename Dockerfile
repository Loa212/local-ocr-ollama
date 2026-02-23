FROM oven/bun:1-alpine

RUN apk add --no-cache poppler-utils

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY . .

ENV PORT=3000
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV OLLAMA_MODEL=glm-ocr
ENV PDF_DPI=200
ENV OCR_TIMEOUT=120
ENV MAX_FILE_SIZE=50
ENV NUM_CTX=16384

EXPOSE 3000
CMD ["bun", "run", "server.ts"]
