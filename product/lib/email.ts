// Contact-form lead delivery. Same convention as server/api/src/lib/email.js:
// EMAIL_ENABLED gates real sending, dev falls back to a console log so the
// form is testable with no SMTP credentials configured.

import nodemailer, { type Transporter } from "nodemailer";

const config = {
  enabled: process.env.EMAIL_ENABLED === "true",
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587", 10),
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,
  from: process.env.EMAIL_FROM || "ProjMan Website <noreply@ebizco.com.au>",
  to: process.env.CONTACT_TO_EMAIL || "sales@ebizco.com.au",
};

let transport: Transporter | null = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }
  return transport;
}

export type ContactLead = {
  name: string;
  email: string;
  company: string;
  role: string;
  message: string;
};

export async function sendContactLead(lead: ContactLead) {
  const subject = `New ProjMan website lead — ${lead.company}`;
  const text =
    `Name: ${lead.name}\n` +
    `Email: ${lead.email}\n` +
    `Company: ${lead.company}\n` +
    `Role: ${lead.role}\n\n` +
    `${lead.message}`;

  if (!config.enabled) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[DEV MAIL] to=${config.to}\n  subject: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
      return { delivered: false, dev: true };
    }
    throw new Error("Email is disabled but a message was required");
  }

  await getTransport().sendMail({
    from: config.from,
    to: config.to,
    replyTo: lead.email,
    subject,
    text,
  });
  return { delivered: true };
}
