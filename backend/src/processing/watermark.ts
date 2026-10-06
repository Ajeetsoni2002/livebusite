import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Setting } from "../modules/models.js";

// Helvetica (WinAnsi) can only draw printable Latin characters; templates are limited to them.
const printable = /^[\x20-\x7E]*$/;
export const watermarkSettingsInput = z
  .object({
    enabled: z.boolean(),
    template: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(printable, "Use plain letters, digits and punctuation only."),
    opacity: z.number().min(0.03).max(0.4),
    angle: z.number().int().min(-90).max(90),
    fontSize: z.number().int().min(10).max(80),
    tiled: z.boolean(),
    footer: z.boolean(),
    skipIfContains: z
      .string()
      .trim()
      .max(60)
      .regex(printable, "Use plain letters, digits and punctuation only."),
  })
  .strict();
export type WatermarkSettings = z.infer<typeof watermarkSettingsInput>;
export const defaultWatermark: WatermarkSettings = {
  enabled: true,
  template: "{subjectCode} | Ajeet Soni",
  opacity: 0.08,
  angle: 35,
  fontSize: 34,
  tiled: true,
  footer: true,
  skipIfContains: "Ajeet Soni",
};

export async function getWatermarkSettings() {
  const doc = await Setting.findOne({ key: "watermark" }).lean<any>();
  return {
    settings: {
      ...defaultWatermark,
      ...(doc?.value || {}),
    } as WatermarkSettings,
    revision: doc?.revision || 0,
  };
}

/** Only the first subject code is used, as agreed; papers without one drop the placeholder. */
export function renderWatermarkText(template: string, subjectCode?: string) {
  const code = (subjectCode || "").replace(/[^\x20-\x7E]/g, "").trim();
  const text = template.replaceAll("{subjectCode}", code);
  return (
    code
      ? text
      : text.replace(/^\s*[|•·\-–,:]+\s*/, "").replace(/\s*[|•·\-–,:]+\s*$/, "")
  ).trim();
}

export class AlreadyWatermarked extends Error {}

/** Runs pdf-lib in a separate process so large scans never stall or bloat the API. */
export function watermarkPdf(
  bytes: Buffer,
  options: WatermarkSettings & { text: string; title?: string },
  timeoutMs = 180_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=320",
        fileURLToPath(new URL("./watermark-worker.mjs", import.meta.url)),
        JSON.stringify(options),
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const out: Buffer[] = [],
      err: Buffer[] = [];
    let size = 0,
      settled = false;
    const limit = bytes.length * 3 + 10 * 1024 * 1024;
    const finish = (error: Error | null, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(
      () => finish(new Error("Watermarking timed out")),
      timeoutMs,
    );
    child.once("error", (e) => finish(e));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit)
        return finish(new Error("Watermarked PDF is too large"));
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.once("close", (code) => {
      if (code === 3) return finish(new AlreadyWatermarked());
      const pdf = Buffer.concat(out);
      if (code === 0 && pdf.subarray(0, 5).toString("latin1") === "%PDF-")
        return finish(null, pdf);
      finish(
        new Error(
          Buffer.concat(err).toString("utf8").slice(0, 200) ||
            `Watermark worker exited with ${code}`,
        ),
      );
    });
    child.stdin.end(bytes);
  });
}
