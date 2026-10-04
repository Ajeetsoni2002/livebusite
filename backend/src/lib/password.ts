import { z } from "zod";

// bcrypt accepts at most 72 UTF-8 bytes; reject rather than silently truncate.
export const passwordInput = z
  .string()
  .min(1)
  .max(72)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
export const newPasswordInput = passwordInput.refine(
  (value) => value.length >= 12,
  "Password must contain at least 12 characters.",
);
