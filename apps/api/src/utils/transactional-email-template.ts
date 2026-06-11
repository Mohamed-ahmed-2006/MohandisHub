import { env } from '../config/env.js';

type EmailAction =
  | {
      kind: 'button';
      label: string;
      url: string;
    }
  | {
      kind: 'code';
      label: string;
      value: string;
    };

export type TransactionalEmailTemplateInput = {
  preheader: string;
  title: string;
  greeting?: string;
  introLines: string[];
  action?: EmailAction;
  expiryText?: string;
  safetyText?: string;
  footerText?: string;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const resolveEmailLogoUrl = (): string | null => {
  const fromEnv = env.EMAIL_LOGO_URL?.trim();
  if (fromEnv) return fromEnv;

  const webBase = env.WEB_PUBLIC_URL?.trim();
  if (!webBase) return null;

  const normalizedBase = webBase.startsWith('http') ? webBase : `https://${webBase}`;

  try {
    return new URL('/brand/mohandishub-email-logo.png', normalizedBase).toString();
  } catch {
    return null;
  }
};

export const buildTransactionalEmailHtml = (input: TransactionalEmailTemplateInput): string => {
  const logoUrl = resolveEmailLogoUrl();
  const preheader = escapeHtml(input.preheader);
  const title = escapeHtml(input.title);
  const greeting = input.greeting
    ? `<p style="margin:0 0 16px;color:#1c1e21;font-size:16px;line-height:24px;">${escapeHtml(input.greeting)}</p>`
    : '';
  const introLines = input.introLines
    .map(
      (line) =>
        `<p style="margin:0 0 12px;color:#4b5563;font-size:15px;line-height:24px;">${escapeHtml(line)}</p>`,
    )
    .join('');

  const actionHtml =
    input.action?.kind === 'button'
      ? [
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 18px;">',
          '<tr>',
          `<td align="center" style="border-radius:999px;background:linear-gradient(92deg,#fd1d1d 0%,#f77737 40%,#f9ce34 100%);">`,
          `<a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(input.action.label)}</a>`,
          '</td>',
          '</tr>',
          '</table>',
          `<p style="margin:0 0 12px;color:#6b7280;font-size:13px;line-height:20px;">If the button does not work, paste this link into your browser:<br><a href="${escapeHtml(input.action.url)}" style="color:#0f766e;text-decoration:underline;word-break:break-all;">${escapeHtml(input.action.url)}</a></p>`,
        ].join('')
      : input.action?.kind === 'code'
        ? [
            '<div style="margin:24px 0 16px;">',
            `<p style="margin:0 0 10px;color:#6b7280;font-size:13px;line-height:20px;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(input.action.label)}</p>`,
            `<p style="margin:0;display:inline-block;padding:12px 18px;border-radius:12px;border:1px solid #e5e7eb;background:#f8fafc;color:#111827;font-size:28px;line-height:32px;font-weight:800;letter-spacing:0.18em;">${escapeHtml(input.action.value)}</p>`,
            '</div>',
          ].join('')
        : '';

  const expiryHtml = input.expiryText
    ? `<p style="margin:0 0 10px;color:#111827;font-size:14px;line-height:22px;font-weight:600;">${escapeHtml(input.expiryText)}</p>`
    : '';
  const safetyHtml = input.safetyText
    ? `<p style="margin:0 0 16px;color:#6b7280;font-size:13px;line-height:20px;">${escapeHtml(input.safetyText)}</p>`
    : '';
  const footerHtml = input.footerText
    ? `<p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:18px;">${escapeHtml(input.footerText)}</p>`
    : '';

  const brandHeader = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="MohandisHub logo" width="160" style="display:block;margin:0 auto;max-width:160px;height:auto;border:0;" />`
    : '<div style="margin:0 auto;font-size:24px;line-height:30px;font-weight:800;color:#111827;letter-spacing:0.02em;">MohandisHub</div>';

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${title}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background:#f3f4f6;">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;">${preheader}</div>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6;padding:30px 12px;">',
    '<tr>',
    '<td align="center">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">',
    '<tr>',
    '<td style="padding:28px 30px 10px;text-align:center;">',
    brandHeader,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:12px 30px 30px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;text-align:left;">',
    `<h1 style="margin:0 0 18px;color:#111827;font-size:24px;line-height:32px;">${title}</h1>`,
    greeting,
    introLines,
    actionHtml,
    expiryHtml,
    safetyHtml,
    '<hr style="margin:22px 0 0;border:none;border-top:1px solid #e5e7eb;">',
    footerHtml,
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
};
