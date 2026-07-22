// Recovery-code delivery.
//
// Nexus sent OTPs by SMS (Vietguys) with email as the fallback. ProjMan2 inverts
// that: email is the channel, because an AU builder's account identity IS their
// email address, and SMS gateways here are a paid integration nobody has chosen yet.
//
// When EMAIL_ENABLED is false the code is printed to the console — in development
// only. In production a disabled mailer is a hard failure, because silently not
// sending a reset code looks identical to a working system from the client side.

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

async function sendMail({ to, subject, text }) {
  if (!config.email.enabled) {
    if (config.server.isDev) {
      console.log(`\n[DEV MAIL] to=${to}\n  subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
      return { delivered: false, dev: true };
    }
    throw new Error('Email is disabled but a message was required');
  }

  await getTransport().sendMail({ from: config.email.from, to, subject, text });
  console.log(`[MAIL] sent "${subject}" → ${maskEmail(to)}`);
  return { delivered: true };
}

function sendRecoveryCode(to, code, purpose) {
  const what = purpose === 'device_loss' ? 'device recovery' : 'password reset';
  return sendMail({
    to,
    subject: `ProjMan2 ${what} code`,
    text:
      `Your ProjMan2 ${what} code is: ${code}\n\n` +
      `It expires in ${Math.round(config.recovery.codeTtlSeconds / 60)} minutes and can be used once.\n` +
      `If you did not request this, ignore this email and your account stays unchanged.\n\n— ProjMan2`,
  });
}

module.exports = { sendMail, sendRecoveryCode, maskEmail };
