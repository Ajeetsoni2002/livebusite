import { config } from "../config.js";
import { renderEmail } from "../lib/email-template.js";
import { sendMail } from "../lib/mail.js";
import { RATE_PER_UPLOAD } from "./earnings.js";

/*
 * Emails around a contributor's uploads and payments. Every function here is a side
 * effect: callers `void` it, and sendMail never throws, so mail can never fail a request.
 */
type Kind = "papers" | "notes";
type Uploaded = { _id: unknown; title: string; status: string };
const singular: Record<Kind, string> = { papers: "paper", notes: "note" };
const firstName = (name: string) => name.split(/\s+/)[0];
const now = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const site = () => config.siteUrl.replace(/\/$/, "");

/** Tells the contributor their upload is in for review, and the admin that it is waiting. */
export async function notifyUploads(user: any, kind: Kind, items: Uploaded[]) {
  if (!items.length || user.role === "admin") return;
  const what = items.length === 1 ? `this ${singular[kind]}` : `these ${kind}`,
    label =
      items.length === 1 ? `a ${singular[kind]}` : `${items.length} ${kind}`,
    titles = items.map((i) => i.title).join("; "),
    published = items.every((i) => i.status === "published");
  const rows: [string, string][] = [
    [items.length === 1 ? "Title" : "Titles", titles],
    ["Type", items.length === 1 ? singular[kind] : kind],
    ["Submitted", now()],
    ["Status", published ? "Published" : "Waiting for review"],
  ];
  await Promise.all([
    sendMail({
      to: user.email,
      subject: published
        ? `Published: ${items.length === 1 ? items[0].title : label}`
        : `Received for review: ${items.length === 1 ? items[0].title : label}`,
      ...renderEmail({
        preheader: published
          ? `Your ${label} is live. ₹${RATE_PER_UPLOAD} per upload is added to what is due to you.`
          : `Your ${label} is waiting for an admin. You are paid once it is approved.`,
        eyebrow: published ? "Published" : "Submission received",
        title: published
          ? "Your upload is live."
          : "Thanks! It's in the review queue.",
        paragraphs: [
          `Hi ${firstName(user.name)},`,
          published
            ? `You have submitted ${what} and, since your account is trusted, it is already published on BUIT Papers.`
            : `You have submitted ${what} for review on BUIT Papers. An admin will check it soon.`,
          published
            ? `₹${RATE_PER_UPLOAD} for each published upload has been added to what is due to you. The admin pays it to the UPI QR code on your profile.`
            : `When the admin approves it, you will receive the payment for it: ₹${RATE_PER_UPLOAD} for each approved upload, paid to the UPI QR code on your profile.`,
        ],
        rows,
        button: {
          label: "See my earnings",
          url: `${site()}/contributor/earnings`,
        },
        note: "Payments are made after approval. If an upload is rejected, the reason appears next to it in your workspace.",
      }),
    }),
    sendMail({
      to: config.adminNotifyEmail,
      subject: `${user.name} uploaded ${label}: ${items[0].title}${items.length > 1 ? ", ..." : ""}`,
      ...renderEmail({
        preheader: `${user.name} uploaded ${label}. ${published ? "It is already live." : "Review and publish it from moderation."}`,
        eyebrow: published
          ? "New upload (auto-published)"
          : "New upload to review",
        title: `${user.name} uploaded ${label}.`,
        paragraphs: [
          published
            ? `This trusted contributor uploaded the following, and it is already published. Have a look when you can.`
            : `This contributor uploaded the following. You can review it and publish it from the moderation queue; approving it adds ₹${RATE_PER_UPLOAD} per upload to what is due to them.`,
        ],
        rows: [
          ["Contributor", `${user.name} (${user.email})`],
          ...rows.filter(([k]) => k !== "Status"),
          ["Payment QR", user.profile?.paymentQrKey ? "Added" : "Missing"],
        ],
        button: published
          ? { label: `Open ${kind}`, url: `${site()}/admin/${kind}` }
          : { label: "Open moderation", url: `${site()}/admin/moderation` },
      }),
    }),
  ]);
}

/** Tells the contributor that the admin marked a payment to them as done. */
export async function notifyPayout(
  user: any,
  payout: { amount: number; note?: string },
  stillDue: number,
) {
  const contact = config.contactEmail || config.adminNotifyEmail;
  await sendMail({
    to: user.email,
    subject: `Payment of ₹${payout.amount} done for your uploads`,
    ...renderEmail({
      preheader: `₹${payout.amount} was paid for your recent uploads on BUIT Papers.`,
      eyebrow: "Payment done",
      title: `We've paid you ₹${payout.amount}.`,
      paragraphs: [
        `Hi ${firstName(user.name)},`,
        `The admin has marked a payment of ₹${payout.amount} as done for your recent approved uploads on BUIT Papers. It was sent to the UPI QR code on your profile.`,
        `Please check your account. If the payment has not arrived, contact the admin${contact ? ` at ${contact}` : ""}.`,
      ],
      rows: [
        ["Amount", `₹${payout.amount}`],
        ["Reference", payout.note || "-"],
        ["Still due", `₹${stillDue}`],
        ["Date", now()],
      ],
      button: {
        label: "See my earnings",
        url: `${site()}/contributor/earnings`,
      },
      note:
        "Each approved paper or note earns ₹" +
        RATE_PER_UPLOAD +
        ". Keep uploading to add to what is due.",
    }),
  });
}
