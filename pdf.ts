import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

function pageSort(a: string, b: string): number {
  const pageA = Number.parseInt(a.match(/page-(\d+)\.png$/)?.[1] ?? "0", 10);
  const pageB = Number.parseInt(b.match(/page-(\d+)\.png$/)?.[1] ?? "0", 10);
  return pageA - pageB;
}

export async function convertPdfToPngPages(pdfPath: string, outputDir: string, dpi: number): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const outputPrefix = path.join(outputDir, "page");

  const process = Bun.spawn({
    cmd: ["pdftoppm", "-r", String(dpi), "-png", pdfPath, outputPrefix],
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text()
  ]);

  if (exitCode !== 0) {
    throw new Error(`pdftoppm failed with exit code ${exitCode}: ${stderr.trim()}`);
  }

  const generatedFiles = (await readdir(outputDir))
    .filter((fileName) => /^page-\d+\.png$/.test(fileName))
    .sort(pageSort)
    .map((fileName) => path.join(outputDir, fileName));

  if (generatedFiles.length === 0) {
    throw new Error("PDF conversion produced no pages");
  }

  return generatedFiles;
}
