import type { Worker } from "tesseract.js";
import { toGray, type Img } from "./core";
import {
  findRollNumber,
  inkShare,
  INK_THRESHOLD,
  OCR_TOP,
  wordsFrom,
  type RollMatch,
} from "./rollnumber";

/*
 * Browser OCR for the roll number check. tesseract.js (and its English data, a few MB)
 * loads only when a scanned paper is processed, and one worker is reused afterwards.
 */
let worker: Promise<Worker> | null = null;
function ocr() {
  worker ??= import("tesseract.js").then((t) => t.createWorker("eng"));
  worker.catch(() => (worker = null));
  return worker;
}

/** Finds a handwritten roll number on a rendered page; null when there is none. */
export async function detectRollNumber(
  canvas: HTMLCanvasElement,
  img: Img,
): Promise<RollMatch | null> {
  const top = document.createElement("canvas");
  top.width = canvas.width;
  top.height = Math.round(canvas.height * OCR_TOP);
  top.getContext("2d")!.drawImage(canvas, 0, 0);
  const { data } = await (await ocr()).recognize(top, {}, { blocks: true });
  const match = findRollNumber(
    wordsFrom(data.blocks),
    canvas.width,
    canvas.height,
  );
  return match && inkShare(toGray(img), match) >= INK_THRESHOLD ? match : null;
}
