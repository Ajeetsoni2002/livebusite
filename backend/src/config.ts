import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

export function parseConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const secret = (name: string) => {
    if (env[name] && env[name].length >= 32) return env[name];
    if (production)
      throw new Error(`${name} secret must contain at least 32 characters`);
    return randomBytes(48).toString("hex");
  };
  const origins = (
    env.CORS_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    origins.some(
      (o) => o === "*" || !/^https?:\/\//.test(o) || new URL(o).origin !== o,
    )
  )
    throw new Error("CORS_ORIGINS must contain exact origins");
  const storageDriver = env.STORAGE_DRIVER || "local";
  if (!["local", "s3"].includes(storageDriver))
    throw new Error("Invalid storage driver");
  if (production && storageDriver !== "s3")
    throw new Error("Production storage must use s3");
  if (
    production &&
    (!env.MONGODB_URI || origins.some((o) => !o.startsWith("https://")))
  )
    throw new Error("Production requires MongoDB and HTTPS origins");
  if (
    production &&
    [
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SITE_URL",
      "API_URL",
      "CONTACT_EMAIL",
    ].some((k) => !env[k])
  )
    throw new Error("Missing production storage/site/contact settings");
  const accessSecret = secret("JWT_ACCESS_SECRET"),
    refreshSecret = secret("JWT_REFRESH_SECRET"),
    analyticsSecret = secret("ANALYTICS_SECRET");
  if (
    production &&
    new Set([accessSecret, refreshSecret, analyticsSecret]).size !== 3
  )
    throw new Error("Use independent secrets");
  const port = Number(env.PORT || 4000),
    maxUploadMB = Number(env.MAX_UPLOAD_MB || 20);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isFinite(maxUploadMB) ||
    maxUploadMB < 1 ||
    maxUploadMB > 100
  )
    throw new Error("Invalid port/upload limit");
  return {
    production,
    port,
    mongoUri:
      env.MONGODB_URI ||
      "mongodb://127.0.0.1:27018/buit_papers?replicaSet=testset",
    origins,
    siteUrl: env.SITE_URL || origins[0],
    apiUrl: env.API_URL || `http://localhost:${port}`,
    accessSecret,
    refreshSecret,
    analyticsSecret,
    storageDriver,
    uploadDir: env.UPLOAD_DIR || "uploads",
    maxUploadBytes: maxUploadMB * 1024 * 1024,
    trustProxy: /^\d+$/.test(env.TRUST_PROXY || "0")
      ? Number(env.TRUST_PROXY || 0)
      : (env.TRUST_PROXY || "").split(",").filter(Boolean),
    s3: {
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION || "auto",
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    atlasSearch: env.ATLAS_SEARCH_ENABLED === "true",
    cfOriginSecret: env.CF_ORIGIN_SECRET || "",
    contactEmail: env.CONTACT_EMAIL || "",
  };
}
export const config = parseConfig();
