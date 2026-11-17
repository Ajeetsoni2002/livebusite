import { api } from "./api";
import {
  DEFAULT_MAX_FILE_BYTES,
  formatMB,
  needsCompression,
} from "./processing/compress-plan";
import type { FitResult } from "./processing/compress";

let limit: Promise<number> | null = null;

/** The server's per-file PDF limit (cached; falls back to the default if unreachable). */
export function uploadLimit() {
  limit ??= api
    .get("/upload-limits", { timeout: 15_000 })
    .then((r) => Number(r.data.data.maxFileBytes) || DEFAULT_MAX_FILE_BYTES)
    .catch(() => {
      limit = null; // ask again next time
      return DEFAULT_MAX_FILE_BYTES;
    });
  return limit;
}

/**
 * Returns the file unchanged when it is within the limit; otherwise compresses it in
 * the browser. The compressor (and pdf.js) is only downloaded when actually needed.
 */
export async function fitForUpload(
  file: File | Blob,
  name: string,
  onStatus: (message: string) => void,
): Promise<FitResult> {
  const pdf =
    file instanceof File
      ? file
      : new File([file], name, { type: "application/pdf" });
  const max = await uploadLimit();
  if (!needsCompression(pdf.size, max))
    return {
      file: pdf,
      compressed: false,
      before: pdf.size,
      after: pdf.size,
      textRasterized: false,
    };
  onStatus(
    `${pdf.name} is ${formatMB(pdf.size)}, over the ${formatMB(max)} limit. Compressing it in your browser…`,
  );
  const { fitPdf } = await import("./processing/compress");
  return fitPdf(pdf, max, (step) => onStatus(`${pdf.name}: ${step}`));
}

export function describeFit(result: FitResult) {
  return `${result.file.name}: compressed ${formatMB(result.before)} → ${formatMB(result.after)}${
    result.dpi ? ` (pages at about ${result.dpi} DPI)` : " (no quality change)"
  }${result.textRasterized ? ". Its text can no longer be selected or searched." : "."}`;
}
