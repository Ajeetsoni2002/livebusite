import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { HttpError, identifier, ok } from "../lib/http.js";
import { storage } from "../storage/index.js";
import type { NextFunction, Response } from "express";
import { audit, AuthRequest } from "./auth.js";
import { Note, Paper, User } from "./models.js";

/*
 * Contributors choose how they appear publicly: their (display) name and photo, or
 * "Anonymous contributor". Admins always see the real account.
 */
export const ANONYMOUS = "Anonymous contributor";
export function publicName(user: any) {
  if (!user) return undefined;
  if (user.profile?.visibility === "anonymous") return ANONYMOUS;
  return user.profile?.displayName || user.name;
}
export function publicPhoto(user: any) {
  const key = user?.profile?.photoKey;
  return user?.profile?.visibility !== "anonymous" && key
    ? `/avatars/${key.slice("avatars/".length)}`
    : null;
}

const profileInput = z
  .object({
    visibility: z.enum(["public", "anonymous"]),
    displayName: z
      .string()
      .trim()
      .max(60)
      .refine((v) => !v || v.length >= 2, "Use at least 2 characters.")
      .optional(),
    bio: z.string().trim().max(160).optional(),
  })
  .strict();
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new HttpError(400, "Upload a JPEG, PNG or WebP image.")),
});
const photoLimit = rateLimit({
  windowMs: 3600_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const profileRouter = Router();
profileRouter.get("/profile", async (req: AuthRequest, res) => {
  const user: any = await User.findById(req.user._id).lean();
  const [papers, notes] = await Promise.all(
    [Paper, Note].map((model) =>
      model.countDocuments({
        author: req.user._id,
        status: "published",
        deletedAt: null,
      }),
    ),
  );
  ok(res, {
    name: user.name,
    visibility: user.profile?.visibility || "public",
    displayName: user.profile?.displayName || "",
    bio: user.profile?.bio || "",
    photo: user.profile?.photoKey
      ? publicPhoto({ profile: { ...user.profile, visibility: "public" } })
      : null,
    published: papers + notes,
    paymentQr: Boolean(user.profile?.paymentQrKey),
  });
});
profileRouter.patch("/profile", async (req: AuthRequest, res) => {
  const input = profileInput.parse(req.body);
  await User.updateOne(
    { _id: req.user._id },
    {
      $set: {
        "profile.visibility": input.visibility,
        "profile.displayName": input.displayName || "",
        "profile.bio": input.bio || "",
      },
    },
  );
  await audit(req, "profile-update", String(req.user._id), {
    visibility: input.visibility,
  });
  ok(res, { saved: true });
});
profileRouter.post(
  "/profile/photo",
  photoLimit,
  photoUpload.single("photo"),
  async (req: AuthRequest, res) => {
    if (!req.file) throw new HttpError(400, "Choose a photo.");
    let image: Buffer;
    try {
      // Re-encoding strips metadata (location, camera) and anything that is not an image.
      image = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(320, 320, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new HttpError(400, "That image could not be read.");
    }
    const key = `avatars/${randomUUID()}.webp`;
    await storage.put(key, image, "image/webp");
    const before: any = await User.findById(req.user._id).lean();
    await User.updateOne(
      { _id: req.user._id },
      { $set: { "profile.photoKey": key } },
    );
    if (before?.profile?.photoKey)
      await storage.delete(before.profile.photoKey).catch(() => {});
    await audit(req, "profile-photo", String(req.user._id));
    ok(res, { photo: `/avatars/${key.slice("avatars/".length)}` });
  },
);
profileRouter.delete("/profile/photo", async (req: AuthRequest, res) => {
  const user: any = await User.findById(req.user._id).lean();
  if (user?.profile?.photoKey) {
    await User.updateOne(
      { _id: req.user._id },
      { $unset: { "profile.photoKey": "" } },
    );
    await storage.delete(user.profile.photoKey).catch(() => {});
  }
  ok(res, { photo: null });
});

/*
 * Payment QR: the UPI QR image the admin scans to pay a contributor. It is required
 * before the first upload and is private: only its owner and admins can see it.
 */
const QR_PREFIX = "payment-qr/";
const qrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(
          new HttpError(
            400,
            "Upload a JPEG, PNG or WebP image of your QR code.",
          ),
        ),
});
export const PAYMENT_QR_REQUIRED = new HttpError(
  412,
  "Add your payment QR code on My profile before your first upload, so you can be paid once it is approved.",
  "PAYMENT_QR_REQUIRED",
);
/** Streams a stored payment QR image, or 404 when there is none. */
export async function sendPaymentQr(
  key: string | undefined,
  res: Response,
  next: NextFunction,
) {
  const object =
    key?.startsWith(QR_PREFIX) && (await storage.get(key).catch(() => null));
  if (!object) throw new HttpError(404, "No payment QR code has been added.");
  res.set({
    "Content-Type": "image/png",
    "Content-Length": String(object.size),
    "Cache-Control": "private, no-store",
  });
  object.body.on("error", next);
  res.on("close", () => object.body.destroy());
  object.body.pipe(res);
}
profileRouter.get(
  "/profile/payment-qr",
  async (req: AuthRequest, res, next) => {
    const user: any = await User.findById(req.user._id)
      .select("profile.paymentQrKey")
      .lean();
    await sendPaymentQr(user?.profile?.paymentQrKey, res, next);
  },
);
profileRouter.post(
  "/profile/payment-qr",
  photoLimit,
  qrUpload.single("qr"),
  async (req: AuthRequest, res) => {
    if (!req.file)
      throw new HttpError(400, "Choose the image of your QR code.");
    let image: Buffer;
    try {
      // Lossless PNG keeps the code scannable; re-encoding strips metadata and anything else.
      image = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch {
      throw new HttpError(400, "That image could not be read.");
    }
    const key = `${QR_PREFIX}${randomUUID()}.png`;
    await storage.put(key, image, "image/png");
    const before: any = await User.findById(req.user._id)
      .select("profile.paymentQrKey")
      .lean();
    await User.updateOne(
      { _id: req.user._id },
      { $set: { "profile.paymentQrKey": key } },
    );
    if (before?.profile?.paymentQrKey)
      await storage.delete(before.profile.paymentQrKey).catch(() => {});
    await audit(req, "payment-qr-set", String(req.user._id));
    ok(res, { paymentQr: true });
  },
);
profileRouter.delete("/profile/payment-qr", async (req: AuthRequest, res) => {
  const user: any = await User.findById(req.user._id)
    .select("profile.paymentQrKey")
    .lean();
  if (user?.profile?.paymentQrKey) {
    await User.updateOne(
      { _id: req.user._id },
      { $unset: { "profile.paymentQrKey": "" } },
    );
    await storage.delete(user.profile.paymentQrKey).catch(() => {});
    await audit(req, "payment-qr-removed", String(req.user._id));
  }
  ok(res, { paymentQr: false });
});

/** Admins see a contributor's payment QR when recording a payout. */
export const paymentQrAdminRouter = Router();
paymentQrAdminRouter.get(
  "/contributors/:id/payment-qr",
  async (req, res, next) => {
    const user: any = await User.findOne({
      _id: identifier(req.params.id),
      role: "contributor",
    })
      .select("profile.paymentQrKey")
      .lean();
    if (!user) throw new HttpError(404, "Contributor not found");
    await sendPaymentQr(user.profile?.paymentQrKey, res, next);
  },
);

/** Public avatars: only for active contributors who chose to show their profile. */
export const avatarRouter = Router();
avatarRouter.get("/avatars/:file", async (req, res, next) => {
  const file = String(req.params.file);
  if (!/^[0-9a-f-]{36}\.webp$/.test(file))
    throw new HttpError(404, "Photo not found");
  const key = `avatars/${file}`;
  const owner = await User.exists({
    "profile.photoKey": key,
    "profile.visibility": { $ne: "anonymous" },
    active: { $ne: false },
  });
  if (!owner) throw new HttpError(404, "Photo not found");
  const object = await storage.get(key).catch(() => null);
  if (!object) throw new HttpError(404, "Photo not found");
  res.set({
    "Content-Type": "image/webp",
    "Content-Length": String(object.size),
    "Cache-Control": "public, max-age=3600",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  object.body.on("error", next);
  res.on("close", () => object.body.destroy());
  object.body.pipe(res);
});
