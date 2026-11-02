import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

type Mail = { to: string; subject: string; text: string; html?: string };

let transport: Transporter | undefined;
function transporter() {
  transport ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transport;
}

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/**
 * Sends one email. Never throws: mail is a side effect and must not fail the request.
 * Without SMTP settings (development) the message is printed instead.
 */
export async function sendMail(mail: Mail) {
  if (!mail.to) return false;
  if (!config.smtp.host) {
    if (process.env.NODE_ENV !== "test")
      console.info(
        `[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`,
      );
    return false;
  }
  try {
    await transporter().sendMail({
      from: `BUIT Papers <${config.smtp.from}>`,
      ...mail,
    });
    return true;
  } catch (error) {
    console.warn("Email failed:", (error as Error)?.message);
    return false;
  }
}
