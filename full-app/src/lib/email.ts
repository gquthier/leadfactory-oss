import nodemailer from "nodemailer";
import { Resend } from "resend";

const DEFAULT_FROM = "Lead Factory <contact@example.com>";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

function parseSecure(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getFromAddress(): string {
  if (process.env.SMTP_FROM?.trim()) {
    return process.env.SMTP_FROM.trim();
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim();
  const fromName = process.env.SMTP_FROM_NAME?.trim();

  if (fromEmail && fromName) {
    return `${fromName} <${fromEmail}>`;
  }

  if (fromEmail) {
    return fromEmail;
  }

  return DEFAULT_FROM;
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = parseSecure(process.env.SMTP_SECURE);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const domain = process.env.SMTP_DOMAIN;
  const from = getFromAddress();

  const enabled = Boolean(host && user && pass && Number.isFinite(port));

  return {
    enabled,
    host,
    port,
    secure,
    user,
    pass,
    domain,
    from,
  };
}

async function sendWithSmtp({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const smtp = getSmtpConfig();

  if (!smtp.enabled) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.domain ? { name: smtp.domain } : {}),
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  try {
    await transporter.sendMail({
      from: smtp.from,
      to,
      subject,
      html,
    });
    console.log(`[email] Sent via SMTP to: ${to}`);
    return true;
  } catch (error) {
    console.error("[email] SMTP send failed:", error);
    return false;
  }
}

/**
 * Brevo (Sendinblue) transactional API. Primary transport: no SMTP creds needed,
 * just BREVO_API_KEY + a verified sender (BREVO_FROM or SMTP_FROM). Robust against
 * SMTP credential rot. Sender email MUST be a verified Brevo sender/domain.
 */
async function sendWithBrevo({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return false;
  }

  const fromRaw = process.env.BREVO_FROM?.trim() || getFromAddress();
  const m = fromRaw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const sender = m ? { name: m[1] || undefined, email: m[2] } : { email: fromRaw };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html }),
    });

    if (!res.ok) {
      console.error("[email] Brevo send failed:", res.status, await res.text());
      return false;
    }

    console.log(`[email] Sent via Brevo to: ${to}`);
    return true;
  } catch (error) {
    console.error("[email] Brevo send error:", error);
    return false;
  }
}

async function sendWithResend({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return false;
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject,
    html,
  });

  if (error) {
    console.error("[email] Resend send failed:", error);
    return false;
  }

  console.log(`[email] Sent via Resend to: ${to}`);
  return true;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  // Brevo API first (primary: no SMTP creds to rot), then SMTP, then Resend.
  const brevoSent = await sendWithBrevo({ to, subject, html });
  if (brevoSent) {
    return;
  }

  const smtpSent = await sendWithSmtp({ to, subject, html });
  if (smtpSent) {
    return;
  }

  const resendSent = await sendWithResend({ to, subject, html });
  if (resendSent) {
    return;
  }

  console.log("[email] No SMTP/Resend configuration found — skipping send.");
  console.log(`[email] Would have sent to: ${to}`);
  console.log(`[email] Subject: ${subject}`);
  console.log(`[email] Body (HTML): ${html}`);
}
