// Recovery-code delivery.
//
// Nexus sent OTPs by SMS (Vietguys) with email as the fallback. ProjMan2 inverts
// that: email is the channel, because an AU builder's account identity IS their
// email address, and SMS gateways here are a paid integration nobody has chosen yet.
//
// When EMAIL_ENABLED is false the code is printed to the console — in development
// only. In production a disabled mailer is a hard failure, because silently not
// sending a reset code looks identical to a working system from the client side.

const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const config     = require('../config');

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transport;
}

const maskEmail = (e) => {
  if (!e) return null;
  const [user, domain] = String(e).split('@');
  if (!domain) return '***';
  return `${user[0]}***@${domain}`;
};

// Embedded (cid) rather than a data: URI — data: images are stripped by Outlook
// desktop, cid attachments render everywhere including Gmail.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const LOGO_CID  = 'projman-logo';

async function sendMail({ to, subject, text, html, attachments }) {
  if (!config.email.enabled) {
    if (config.server.isDev) {
      console.log(`\n[DEV MAIL] to=${to}\n  subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
      return { delivered: false, dev: true };
    }
    throw new Error('Email is disabled but a message was required');
  }

  await getTransport().sendMail({ from: config.email.from, to, subject, text, html, attachments });
  console.log(`[MAIL] sent "${subject}" → ${maskEmail(to)}`);
  return { delivered: true };
}

// Recovery-code email — same layout family as the portal/app: a dark header
// lockup, a plain-language headline, the code in its own bordered block. Plain
// `text` stays the fallback for clients that strip HTML.
function recoveryEmailHtml({ name, code, what, expiresMinutes }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#eaeef4;font-family:'DM Sans',Arial,sans-serif;">
    <center>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="text-align:center;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(22,32,46,.12);">
          <tr><td style="padding:28px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:#16202e;border-radius:12px;">
              <tr>
                <td style="padding:16px 22px;">
                  <img src="cid:${LOGO_CID}" width="34" height="34" alt="ProjMan" style="vertical-align:middle;border-radius:6px;display:inline-block;" />
                  <span style="vertical-align:middle;margin-left:10px;font-size:19px;font-weight:800;color:#ffffff;letter-spacing:.01em;">ProjMan<span style="color:#f97316;">.</span></span>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:28px 32px 4px 32px;">
            <h1 style="margin:0 0 14px 0;font-size:23px;line-height:1.3;color:#16202e;font-weight:800;">Let's get you ${what.headline}</h1>
            <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#44516a;">${greeting}</p>
            <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#44516a;">${what.body}</p>
          </td></tr>
          <tr><td style="padding:0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;border:2px solid #c4cedd;border-radius:10px;">
              <tr><td style="padding:16px 20px;text-align:center;">
                <span style="font-family:'JetBrains Mono',monospace;font-size:30px;font-weight:800;letter-spacing:.14em;color:#16202e;">${code}</span>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:14px 32px 32px 32px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#5b6880;">
              This code expires in ${expiresMinutes} minutes and can be used once.
              If you did not request this, ignore this email — your account stays unchanged.
            </p>
          </td></tr>
        </table>
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 0 auto;max-width:100%;background:#c2410c;border-radius:12px;">
          <tr><td style="padding:16px 32px;text-align:center;">
            <span style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:.02em;">Every project anchors to proof.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
    </center>
  </body>
</html>`;
}

function sendRecoveryCode(to, code, purpose, name) {
  const isDeviceLoss = purpose === 'device_loss';
  const what = isDeviceLoss
    ? { headline: 'your device back', body: 'We received a request to recover a lost or replaced device on your ProjMan account.' }
    : { headline: 'signed in', body: 'We received a request to reset the password on your ProjMan account.' };
  const expiresMinutes = Math.round(config.recovery.codeTtlSeconds / 60);

  return sendMail({
    to,
    subject: `ProjMan ${isDeviceLoss ? 'device recovery' : 'password reset'} code`,
    text:
      `Your ProjMan ${isDeviceLoss ? 'device recovery' : 'password reset'} code is: ${code}\n\n` +
      `It expires in ${expiresMinutes} minutes and can be used once.\n` +
      `If you did not request this, ignore this email and your account stays unchanged.\n\n— ProjMan`,
    html: recoveryEmailHtml({ name, code, what, expiresMinutes }),
    attachments: [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }],
  });
}

module.exports = { sendMail, sendRecoveryCode, maskEmail };
