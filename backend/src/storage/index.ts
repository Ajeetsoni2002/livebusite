import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { FileAsset } from "../modules/models.js";
import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";
import { ensureThumbnail } from "./thumbnail.js";
import type {} from "multer";
export const storage =
  config.storageDriver === "s3"
    ? new S3Storage()
    : new LocalStorage(config.uploadDir);
export async function validatePdf(bytes: Buffer, mime: string) {
  if (bytes.length > config.maxUploadBytes)
    throw new HttpError(413, "PDF exceeds the upload size limit.");
  if (
    mime !== "application/pdf" ||
    bytes.length < 8 ||
    (await fileTypeFromBuffer(bytes))?.mime !== "application/pdf"
  )
    throw new HttpError(400, "Upload a PDF file with valid PDF content.");
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 2000) throw new Error();
  } catch {
    throw new HttpError(400, "PDF is malformed, encrypted or unreadable.");
  }
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}
export function safeFilename(name: string) {
  return (
    name
      .replace(/[^a-zA-Z0-9 ._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "paper.pdf"
  );
}
export async function savePdf(file: {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}) {
  const metadata = await validatePdf(file.buffer, file.mimetype);
  const existing = await FileAsset.findOne({ hash: metadata.hash });
  if (existing) {
    await ensureThumbnail(existing, file.buffer, storage);
    return existing;
  }
  const key = `uploads/${randomUUID()}.pdf`;
  await storage.put(key, file.buffer, "application/pdf");
  try {
    const asset = await FileAsset.create({
      ...metadata,
      key,
      mime: "application/pdf",
      originalName: safeFilename(file.originalname),
    });
    await ensureThumbnail(asset, file.buffer, storage);
    return asset;
  } catch (e: any) {
    await storage.delete(key);
    if (e.code === 11000) return FileAsset.findOne({ hash: metadata.hash });
    throw e;
  }
}
