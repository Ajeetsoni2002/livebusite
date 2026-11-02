import { config } from "../config.js";

/*
 * Branded HTML email in the site's light "answer sheet" theme: cream paper, a red
 * margin rule, navy ink and a serif heading. Email clients ignore <style> blocks and
 * web fonts unevenly, so everything is tables with inline styles and Georgia/Arial.
 */
const C = {
  page: "#f3eee2",
  paper: "#fffdf8",
  rule: "#e4dccb",
  ink: "#1a1d26",
  muted: "#57534a",
  navy: "#1f3ea8",
  red: "#b82424",
  soft: "#f6f1e4",
};
const serif = "Georgia, 'Times New Roman', serif";
const sans = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export type EmailContent = {
  /** Inbox preview line shown after the subject. */
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  /** Label/value rows shown in a ruled card, like an answer-sheet header. */
  rows?: [string, string][];
  button?: { label: string; url: string };
  /** Small print under the button, e.g. "This link works for 30 minutes." */
  note?: string;
};

export function renderEmail(content: EmailContent) {
  const site = config.siteUrl.replace(/\/$/, "");
  const e = escapeHtml;
  const host = (() => {
    try {
      return new URL(site).host;
    } catch {
      return site;
    }
  })();
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font:16px/1.65 ${sans};color:${C.ink};">${e(p)}</p>`,
    )
    .join("");
  const rows = content.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border:1px solid ${C.rule};border-radius:10px;background:${C.soft};border-collapse:separate;">${content.rows
        .map(
          ([label, value], i) =>
            `<tr><td style="padding:11px 16px;${i ? `border-top:1px dashed ${C.rule};` : ""}font:600 11px/1.4 ${sans};letter-spacing:1.2px;text-transform:uppercase;color:${C.muted};width:34%;vertical-align:top;">${e(label)}</td><td style="padding:11px 16px;${i ? `border-top:1px dashed ${C.rule};` : ""}font:15px/1.5 ${sans};color:${C.ink};vertical-align:top;">${e(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="border-radius:999px;background:${C.navy};box-shadow:0 2px 0 #142a78;"><a href="${e(content.button.url)}" style="display:inline-block;padding:14px 28px;font:700 15px/1 ${sans};color:#ffffff;text-decoration:none;border-radius:999px;">${e(content.button.label)} &rarr;</a></td></tr></table><p style="margin:10px 0 0;font:12px/1.6 ${sans};color:${C.muted};word-break:break-all;">Button not working? Open this link:<br/><a href="${e(content.button.url)}" style="color:${C.navy};">${e(content.button.url)}</a></p>`
    : "";
  const note = content.note
    ? `<p style="margin:18px 0 0;padding:12px 14px;border-left:3px solid ${C.red};background:${C.soft};font:13px/1.6 ${sans};color:${C.muted};">${e(content.note)}</p>`
    : "";
  const links = [
    ["Question papers", "/papers"],
    ["Notes", "/notes"],
    ["Jobs", "/jobs"],
    ["Contribute", "/contribute"],
  ]
    .map(
      ([label, path]) =>
        `<a href="${site}${path}" style="color:${C.navy};text-decoration:none;font-weight:600;">${label}</a>`,
    )
    .join(`<span style="color:${C.rule};">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light only"/><meta name="supported-color-schemes" content="light"/><title>${e(content.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${e(content.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 6px 16px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:12px;"><a href="${site}/"><img src="${site}/branding/crest.png" width="44" height="44" alt="BUIT Papers" style="display:block;border:0;border-radius:10px;"/></a></td>
    <td style="vertical-align:middle;"><a href="${site}/" style="text-decoration:none;"><span style="font:700 22px/1.1 ${serif};color:${C.ink};">BUIT <span style="color:${C.navy};">Papers</span></span><br/><span style="font:600 10px/1.8 ${sans};letter-spacing:1.6px;color:${C.muted};">BARKATULLAH UNIVERSITY &middot; BHOPAL</span></a></td>
  </tr></table>
</td></tr>
<tr><td style="background:${C.paper};border:1px solid ${C.rule};border-radius:16px;box-shadow:0 10px 30px rgba(26,29,38,0.08);overflow:hidden;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="width:6px;background:${C.red};font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:34px 34px 30px;">
      <p style="margin:0 0 10px;font:700 11px/1.4 ${sans};letter-spacing:2px;text-transform:uppercase;color:${C.red};">${e(content.eyebrow)}</p>
      <h1 style="margin:0 0 18px;font:400 32px/1.2 ${serif};color:${C.ink};">${e(content.title)}</h1>
      <div style="height:2px;width:56px;background:${C.navy};margin:0 0 22px;line-height:2px;font-size:0;">&nbsp;</div>
      ${paragraphs}${rows}${button}${note}
    </td>
  </tr></table>
</td></tr>
<tr><td align="center" style="padding:22px 10px 6px;font:13px/1.8 ${sans};">${links}</td></tr>
<tr><td align="center" style="padding:4px 10px 0;font:12px/1.7 ${sans};color:${C.muted};">
  Free previous year question papers &amp; notes &middot; <a href="${site}/" style="color:${C.muted};">${e(host)}</a><br/>
  Made by students, for students. Unofficial resource, not affiliated with Barkatullah University.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    content.title,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.rows || []).map(([k, v]) => `${k}: ${v}`),
    ...(content.rows?.length ? [""] : []),
    ...(content.button
      ? [`${content.button.label}: ${content.button.url}`, ""]
      : []),
    ...(content.note ? [content.note, ""] : []),
    `BUIT Papers - ${site}/`,
  ].join("\n");
  return { html, text };
}
