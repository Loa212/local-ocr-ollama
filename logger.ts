function ts(): string {
  return new Date().toISOString();
}

export function log(message: string, context?: Record<string, unknown>): void {
  const extra = context ? ` ${JSON.stringify(context)}` : "";
  console.log(`[${ts()}] INFO  ${message}${extra}`);
}

export function warn(message: string, context?: Record<string, unknown>): void {
  const extra = context ? ` ${JSON.stringify(context)}` : "";
  console.warn(`[${ts()}] WARN  ${message}${extra}`);
}

export function error(message: string, err?: unknown, context?: Record<string, unknown>): void {
  const extra = context ? ` ${JSON.stringify(context)}` : "";
  const detail =
    err instanceof Error
      ? `\n${err.stack ?? err.message}`
      : err !== undefined
        ? ` — ${String(err)}`
        : "";
  console.error(`[${ts()}] ERROR ${message}${extra}${detail}`);
}
