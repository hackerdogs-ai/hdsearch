// Transactional email (password reset + magic-link sign-in). Entirely optional:
// when SMTP is not configured the app runs exactly as before, those flows are
// hidden in the UI, and the endpoints report email as unavailable.
//
// Config precedence, matching the rest of the app:  admin UI → env → unset.
//   admin UI : non-secret settings in runtime-config; the password is AES-256-GCM
//              encrypted in the DB via the system-key store (never on disk in clear)
//   env      : SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM /
//              SMTP_SECURE — for headless Docker deploys
import nodemailer, { type Transporter } from 'nodemailer';
import { getSmtpConfig } from './runtime-config.js';
import { resolveDefaultKey } from './ai/default-keys.js';
import { log, errFields } from './logger.js';

/** Credential field the SMTP password is stored under in system_provider_keys. */
export const SMTP_PASSWORD_FIELD = 'smtp_password';

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  secure: boolean;
  hasPassword: boolean;
}

function envStr(name: string): string {
  return (process.env[name] || '').trim();
}

/** Non-secret SMTP settings. Admin values win; env fills the gaps. */
export async function smtpSettings(): Promise<SmtpSettings> {
  const cfg = getSmtpConfig();
  const host = (cfg.host || envStr('SMTP_HOST')).trim();
  const portRaw = cfg.port ?? Number(envStr('SMTP_PORT') || 0);
  const user = (cfg.user || envStr('SMTP_USER')).trim();
  const from = (cfg.from || envStr('SMTP_FROM') || user).trim();
  const secure =
    typeof cfg.secure === 'boolean' ? cfg.secure : /^(1|true|yes|on)$/i.test(envStr('SMTP_SECURE'));
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Number(portRaw) : secure ? 465 : 587;
  return { host, port, user, from, secure, hasPassword: !!(await smtpPassword()) };
}

/** Encrypted admin-set password, else the env value. Empty when unauthenticated SMTP. */
async function smtpPassword(): Promise<string> {
  try {
    const stored = await resolveDefaultKey(SMTP_PASSWORD_FIELD);
    if (stored) return stored;
  } catch (e) {
    log.debug('smtp password lookup failed', errFields(e));
  }
  return envStr('SMTP_PASSWORD');
}

/**
 * Is transactional email usable? Requires at minimum a host and a From address.
 * Drives whether password-reset and magic-link sign-in are offered at all.
 */
export async function emailEnabled(): Promise<boolean> {
  const s = await smtpSettings();
  return !!(s.host && s.from);
}

let cached: { key: string; transport: Transporter } | null = null;

async function transport(): Promise<{ t: Transporter; from: string } | null> {
  const s = await smtpSettings();
  if (!s.host || !s.from) return null;
  const pass = await smtpPassword();
  // Rebuild only when the effective settings change (admin may edit at runtime).
  const key = `${s.host}:${s.port}:${s.user}:${s.secure}:${pass ? 'pw' : 'nopw'}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        ...(s.user || pass ? { auth: { user: s.user, pass } } : {}),
      }),
    };
  }
  return { t: cached.transport, from: s.from };
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send one message. Returns false when email is not configured or the send fails —
 * callers must not leak that difference to unauthenticated users (see the
 * no-enumeration handling in routes/auth-local.ts).
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const conn = await transport();
  if (!conn) return false;
  try {
    await conn.t.sendMail({
      from: conn.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
    log.info('email sent', { to: maskEmail(mail.to), subject: mail.subject });
    return true;
  } catch (e) {
    log.error('email send failed', { to: maskEmail(mail.to), ...errFields(e) });
    return false;
  }
}

/** Verify the SMTP connection without sending (admin "test connection"). */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const conn = await transport();
  if (!conn) return { ok: false, error: 'SMTP is not configured (host and from address are required)' };
  try {
    await conn.t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Drop the cached transport after an admin settings change. */
export function invalidateSmtpTransport(): void {
  cached = null;
}

/** a***e@example.com — enough to correlate logs without recording the address. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : '';
  return `${head}***${tail}@${domain}`;
}
