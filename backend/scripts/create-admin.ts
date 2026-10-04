import { newPasswordInput } from "../src/lib/password.js";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { z } from "zod";
import { config } from "../src/config.js";
import { User } from "../src/modules/models.js";
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = newPasswordInput.parse(process.env.ADMIN_PASSWORD);
await mongoose.connect(config.mongoUri);
try {
  if (await User.exists({ email }))
    throw new Error(
      "Account already exists; use the admin password-reset action.",
    );
  await User.create({
    email,
    name: process.env.ADMIN_NAME || "Library administrator",
    role: "admin",
    passwordHash: await bcrypt.hash(password, 12),
    mustChangePassword: true,
  });
  console.info("Admin created. Change the temporary password on first login.");
} finally {
  await mongoose.disconnect();
}
