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
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
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

/** Which way mail leaves the server: Brevo's HTTPS API, SMTP, or nowhere (printed). */
export const mailProvider = () =>
  config.brevoApiKey ? "brevo" : config.smtp.host ? "smtp" : "none";

/*
 * Brevo's HTTPS API works where outbound SMTP ports are blocked (Render's free plan
 * blocks 25, 465 and 587), so it is preferred whenever its key is set.
 */
async function sendWithBrevo(mail: Mail) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.brevoApiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "BUIT Papers", email: config.smtp.from },
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      ...(mail.html ? { htmlContent: mail.html } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Brevo ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
}

/** Sends one email and throws on failure; used by the admin "send test email" check. */
export async function deliverMail(mail: Mail) {
  const provider = mailProvider();
  if (provider === "none")
    throw new Error(
      "No email service is configured. Set BREVO_API_KEY (or SMTP_HOST) and MAIL_FROM.",
    );
  if (!config.smtp.from) throw new Error("MAIL_FROM is not set.");
  if (provider === "brevo") await sendWithBrevo(mail);
  else
    await transporter().sendMail({
      from: `BUIT Papers <${config.smtp.from}>`,
      ...mail,
    });
}

/**
 * Sends one email. Never throws: mail is a side effect and must not fail the request.
 * Without any mail settings (development) the message is printed instead.
 */
export async function sendMail(mail: Mail) {
  if (!mail.to) {
    console.warn(`Email skipped (no recipient): ${mail.subject}`);
    return false;
  }
  if (mailProvider() === "none") {
    if (process.env.NODE_ENV !== "test")
      console.info(
        `[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`,
      );
    return false;
  }
  try {
    await deliverMail(mail);
    return true;
  } catch (error) {
    console.warn(
      `Email failed via ${mailProvider()}:`,
      (error as Error)?.message,
    );
    return false;
  }
}
