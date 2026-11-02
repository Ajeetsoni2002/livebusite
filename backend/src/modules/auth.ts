import { passwordInput, newPasswordInput } from "../lib/password.js";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError, ok } from "../lib/http.js";
import { escapeHtml, sendMail } from "../lib/mail.js";
import {
  User,
  Session,
  AuditLog,
  PasswordReset,
  ContributorRequest,
} from "./models.js";
export type AuthRequest = Request & { user?: any; session?: any };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: "lax" as const,
  path: "/api",
};
const verify = (token: string, secret: string) =>
  jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "buit-api",
    audience: "buit-library",
  }) as jwt.JwtPayload;
const sign = (user: any, session: any, refresh = false) =>
  jwt.sign(
    { sub: String(user._id), sid: String(session._id), jti: randomUUID() },
    refresh ? config.refreshSecret : config.accessSecret,
    {
      algorithm: "HS256",
      expiresIn: refresh ? "7d" : "15m",
      issuer: "buit-api",
      audience: "buit-library",
    },
  );
function cookies(res: Response, access: string, refresh: string) {
  res.cookie("access", access, { ...cookieOptions, maxAge: 15 * 60_000 });
  res.cookie("refresh", refresh, { ...cookieOptions, maxAge: 7 * 86400_000 });
  res.setHeader("Cache-Control", "no-store");
}
export async function audit(
  req: AuthRequest,
  action: string,
  target = "",
  details: object = {},
) {
  await AuditLog.create({
    actor: req.user?._id,
    action,
    target,
    details,
    ipHash: createHmac("sha256", config.analyticsSecret)
      .update(`audit:${req.ip || ""}`)
      .digest("hex"),
  });
}
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookie = req.cookies?.csrf,
    header = req.get("X-CSRF-Token");
  if (
    typeof cookie !== "string" ||
    typeof header !== "string" ||
    cookie.length !== header.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
  )
    return next(
      new HttpError(403, "Refresh the page and try again.", "CSRF_REQUIRED"),
    );
  const [nonce, signature] = cookie.split(".");
  const expected = createHmac("sha256", config.accessSecret)
    .update(nonce || "")
    .digest("hex");
  if (
    signature !== expected ||
    (req.get("Origin") && !config.origins.includes(req.get("Origin")))
  )
    return next(
      new HttpError(403, "Request verification failed", "CSRF_REQUIRED"),
    );
  next();
}
export async function optionalUser(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (req.cookies?.access) {
      const payload = verify(req.cookies.access, config.accessSecret);
      const session = await Session.findOne({
        _id: payload.sid,
        user: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      const user =
        session && (await User.findOne({ _id: payload.sub, active: true }));
      if (user) {
        req.user = user;
        req.session = session;
      }
    }
  } catch {
    /* Invalid cookies are anonymous on public routes. */
  }
  next();
}
export async function requireUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  await optionalUser(req, res, () => {});
  if (!req.user)
    return next(new HttpError(401, "Please sign in.", "UNAUTHENTICATED"));
  res.setHeader("Cache-Control", "no-store");
  next();
}
export function requireRole(role: "admin" | "contributor") {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role)
      return next(
        new HttpError(
          403,
          "You do not have access to this action.",
          "FORBIDDEN",
        ),
      );
    if (req.user.mustChangePassword)
      return next(
        new HttpError(
          403,
          "Change your temporary password first.",
          "PASSWORD_CHANGE_REQUIRED",
        ),
      );
    next();
  };
}
const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase().trim()),
    password: passwordInput,
  })
  .strict();
const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/csrf", (_req, res) => {
  const nonce = randomBytes(32).toString("hex");
  const token = `${nonce}.${createHmac("sha256", config.accessSecret).update(nonce).digest("hex")}`;
  res.cookie("csrf", token, { ...cookieOptions, maxAge: 86400_000 });
  ok(res, { token });
});
const loginLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      error: {
        code: "LOGIN_RATE_LIMIT",
        message: "Too many attempts. Try again later.",
        requestId: res.locals.requestId,
      },
    }),
});
const dummyHash = bcrypt.hash("dummy-credential-never-valid", 12);
router.post(
  "/login",
  loginLimit,
  requireCsrf,
  async (req: AuthRequest, res) => {
    const input = credentials.parse(req.body),
      user = await User.findOne({ email: input.email }).select("+passwordHash");
    const match = await bcrypt.compare(
      input.password,
      user?.passwordHash || (await dummyHash),
    );
    if (!user || !user.active || !match || user.lockedUntil > new Date()) {
      if (user && !(user.lockedUntil > new Date())) {
        const changed = await User.findByIdAndUpdate(
          user._id,
          { $inc: { failedLogins: 1 } },
          { returnDocument: "after" },
        );
        if (changed.failedLogins >= 5)
          await User.updateOne(
            { _id: user._id },
            { $set: { lockedUntil: new Date(Date.now() + 15 * 60_000) } },
          );
      }
      await audit(req, "login-failed");
      throw new HttpError(
        401,
        "Invalid credentials or account temporarily unavailable.",
        "LOGIN_FAILED",
      );
    }
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLogins: 0,
          lockedUntil: null,
          ...(user.firstLoginAt ? {} : { firstLoginAt: new Date() }),
        },
      },
    );
    await startSession(req, res, user);
    await audit(req, "login", String(user._id));
    ok(res, me(user));
  },
);
const me = (user: any) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
});
async function startSession(req: AuthRequest, res: Response, user: any) {
  const session = new Session({
    user: user._id,
    refreshHash: "pending",
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const refresh = sign(user, session, true);
  session.refreshHash = digest(refresh);
  await session.save();
  cookies(res, sign(user, session), refresh);
  req.user = user;
}
const limited = (limit: number, windowMs: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        error: { code: "RATE_LIMIT", message, requestId: res.locals.requestId },
      }),
  });
const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase().trim());
const registerInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    password: newPasswordInput,
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 -]{7,18}$/, "Enter a valid phone number.")
      .optional()
      .or(z.literal("")),
    branch: z.string().trim().max(80).optional(),
    semester: z.coerce.number().int().min(1).max(12).optional(),
    consent: z.literal(true, "Please confirm you may share these files."),
    // Bot trap: humans never see or fill this field.
    website: z.string().max(200).optional(),
  })
  .strict();
// Students create their own contributor account; their uploads still wait for an admin.
router.post(
  "/register",
  limited(5, 60 * 60_000, "Too many sign-ups from here. Try again later."),
  requireCsrf,
  async (req: AuthRequest, res) => {
    const {
      website,
      consent: _consent,
      password,
      ...data
    } = registerInput.parse(req.body);
    if (website) throw new HttpError(400, "Please try again.");
    if (await User.exists({ email: data.email }))
      throw new HttpError(
        409,
        "An account with this email already exists. Sign in, or use “Forgot password”.",
        "EMAIL_TAKEN",
      );
    const now = new Date();
    const user = await User.create({
      ...data,
      phone: data.phone || undefined,
      passwordHash: await bcrypt.hash(password, 12),
      role: "contributor",
      trusted: false,
      mustChangePassword: false,
      selfRegistered: true,
      firstLoginAt: now,
    });
    await ContributorRequest.updateMany(
      { email: data.email, status: "open" },
      { $set: { status: "approved", user: user._id, handledAt: now } },
    );
    // Signing up is the account's first sign-in, so the admin hears about it once, here.
    await startSession(req, res, user);
    await audit(req, "contributor-registered", String(user._id));
    void notifyNewContributor(user);
    res.status(201);
    ok(res, me(user));
  },
);
function notifyNewContributor(user: any) {
  const rows: [string, string][] = [
    ["Name", user.name],
    ["Email", user.email],
    ["Phone", user.phone || "-"],
    ["Branch", user.branch || "-"],
    ["Semester", user.semester ? String(user.semester) : "-"],
    [
      "Joined",
      new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    ],
  ];
  const link = `${config.siteUrl}/admin/contributors`;
  return sendMail({
    to: config.adminNotifyEmail,
    subject: `New contributor: ${user.name}`,
    text: `${user.name} just created a contributor account on BUIT Papers.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nTheir uploads wait for your approval. Manage contributors: ${link}`,
    html: `<p><strong>${escapeHtml(user.name)}</strong> just created a contributor account on BUIT Papers.</p><table cellpadding="4">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escapeHtml(v)}</td></tr>`).join("")}</table><p>Their uploads wait for your approval.</p><p><a href="${link}">Manage contributors</a></p>`,
  });
}
const RESET_MINUTES = 30;
// Same answer whether or not the email exists, so the form cannot be used to find accounts.
router.post(
  "/forgot-password",
  limited(5, 15 * 60_000, "Too many requests. Try again in a few minutes."),
  requireCsrf,
  async (req: AuthRequest, res) => {
    const input = z.object({ email }).strict().parse(req.body);
    const user = await User.findOne({ email: input.email, active: true });
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await PasswordReset.deleteMany({ user: user._id });
      await PasswordReset.create({
        user: user._id,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
      });
      const link = `${config.siteUrl}/reset-password?token=${token}`;
      void sendMail({
        to: user.email,
        subject: "Reset your BUIT Papers password",
        text: `Hi ${user.name},\n\nOpen this link to choose a new password (it works for ${RESET_MINUTES} minutes):\n${link}\n\nIf you did not ask for this, ignore this email; your password stays the same.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${link}">Choose a new password</a>. The link works for ${RESET_MINUTES} minutes.</p><p>If you did not ask for this, ignore this email; your password stays the same.</p>`,
      });
      req.user = user;
      await audit(req, "password-reset-requested", String(user._id));
    }
    ok(res, { sent: true });
  },
);
router.post(
  "/reset-password",
  limited(10, 15 * 60_000, "Too many attempts. Try again in a few minutes."),
  requireCsrf,
  async (req: AuthRequest, res) => {
    const input = z
      .object({
        token: z.string().min(20).max(100),
        password: newPasswordInput,
      })
      .strict()
      .parse(req.body);
    const reset = await PasswordReset.findOneAndUpdate(
      {
        tokenHash: digest(input.token),
        usedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
    );
    const user =
      reset && (await User.findOne({ _id: reset.user, active: true }));
    if (!user)
      throw new HttpError(
        400,
        "This reset link is invalid or has expired. Ask for a new one.",
        "RESET_INVALID",
      );
    user.passwordHash = await bcrypt.hash(input.password, 12);
    user.mustChangePassword = false;
    user.failedLogins = 0;
    user.lockedUntil = null;
    await user.save();
    await Session.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    req.user = user;
    await audit(req, "password-reset", String(user._id));
    ok(res, { reset: true, role: user.role });
  },
);
router.get("/me", requireUser, (req: AuthRequest, res) =>
  ok(res, me(req.user)),
);
router.post("/refresh", requireCsrf, async (req: AuthRequest, res) => {
  let payload: jwt.JwtPayload;
  try {
    payload = verify(req.cookies.refresh, config.refreshSecret);
  } catch {
    throw new HttpError(401, "Session expired. Please sign in.");
  }
  const session = await Session.findOne({
      _id: payload.sid,
      user: payload.sub,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }),
    user = session && (await User.findOne({ _id: payload.sub, active: true }));
  if (!session || !user)
    throw new HttpError(401, "Session expired. Please sign in.");
  const refresh = sign(user, session, true);
  const rotated = await Session.findOneAndUpdate(
    {
      _id: session._id,
      refreshHash: digest(req.cookies.refresh),
      revokedAt: null,
    },
    { $set: { refreshHash: digest(refresh) } },
    { returnDocument: "after" },
  );
  if (!rotated) {
    await Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date() } },
    );
    throw new HttpError(401, "Session replay detected. Please sign in.");
  }
  cookies(res, sign(user, session), refresh);
  ok(res, { refreshed: true });
});
router.post("/logout", requireCsrf, async (req: AuthRequest, res) => {
  for (const name of ["access", "refresh"]) {
    try {
      const p = verify(
        req.cookies[name],
        name === "access" ? config.accessSecret : config.refreshSecret,
      );
      await Session.updateOne(
        { _id: p.sid },
        { $set: { revokedAt: new Date() } },
      );
    } catch {}
    res.clearCookie(name, cookieOptions);
  }
  ok(res, { loggedOut: true });
});
router.post(
  "/change-password",
  requireCsrf,
  requireUser,
  async (req: AuthRequest, res) => {
    const input = z
      .object({
        currentPassword: passwordInput,
        newPassword: newPasswordInput,
      })
      .strict()
      .parse(req.body);
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash)))
      throw new HttpError(400, "Current password is incorrect.");
    if (input.currentPassword === input.newPassword)
      throw new HttpError(400, "Choose a different password.");
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    user.mustChangePassword = false;
    await user.save();
    await Session.updateMany(
      { user: user._id, _id: { $ne: req.session._id } },
      { $set: { revokedAt: new Date() } },
    );
    await audit(req, "password-changed", String(user._id));
    ok(res, { changed: true });
  },
);
export const authRouter = router;
