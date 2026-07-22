// SMS delivery + Australian mobile normalisation.
//
// Same stance as email.js: a real provider in production, console in development.
// The provider is deliberately config, not a hardcoded choice — the deployment picks
// one, and the data-residency rule (AU servers) points at an AU-resident sender such
// as MessageMedia or SNS Sydney. Concrete providers are thin adapters below; the
// route code never knows which one is live.

const config = require('../config');

/**
 * Normalise an Australian mobile to E.164 (+614XXXXXXXX), or null if it is not a
 * valid AU mobile. Accepts `04xx xxx xxx`, `+61 4xx…`, `61 4xx…`, with spaces/dashes.
 */
function normaliseAuMobile(raw) {
  const digits = String(raw || '').replace(/[\s()-]/g, '');
  let m = digits;
  if (m.startsWith('+61')) m = '0' + m.slice(3);
  else if (m.startsWith('61')) m = '0' + m.slice(2);
  // AU mobiles are 04 followed by 8 digits.
  if (!/^04\d{8}$/.test(m)) return null;
  return '+61' + m.slice(1);
}

const maskMobile = (e164) => (e164 ? e164.slice(0, 6) + '***' + e164.slice(-2) : null);

// ── Providers (adapters) ──────────────────────────────────────
async function sendViaConsole(to, text) {
  console.log(`\n[DEV SMS] to=${to}\n  ${text}\n`);
  return { delivered: false, dev: true };
}

async function sendViaMessageMedia(to, text) {
  // MessageMedia (Australian sender). Adapter kept minimal; wire real creds in prod.
  const { apiKey, apiSecret } = config.sms.messagemedia;
  if (!apiKey || !apiSecret) throw new Error('MessageMedia credentials are not configured');
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const resp = await fetch('https://api.messagemedia.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ messages: [{ content: text, destination_number: to, source_number: config.sms.from }] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`MessageMedia send failed (${resp.status})`);
  return { delivered: true };
}

async function sendViaTwilio(to, text) {
  const { sid, token, from } = config.sms.twilio;
  if (!sid || !token) throw new Error('Twilio credentials are not configured');
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ To: to, From: from || config.sms.from, Body: text });
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Twilio send failed (${resp.status})`);
  return { delivered: true };
}

async function sendSms(to, text) {
  // Disabled or console provider → log in dev, hard-fail in prod (a silently
  // undelivered verification code looks identical to a working one from the client).
  if (!config.sms.enabled || config.sms.provider === 'console') {
    if (config.server.isDev) return sendViaConsole(to, text);
    throw new Error('SMS is disabled but a message was required');
  }
  if (config.sms.provider === 'messagemedia') return sendViaMessageMedia(to, text);
  if (config.sms.provider === 'twilio')       return sendViaTwilio(to, text);
  throw new Error(`Unknown SMS provider: ${config.sms.provider}`);
}

function sendVerificationCode(to, code) {
  return sendSms(to, `Your ProjMan2 verification code is ${code}. It expires in ${Math.round(config.sms.codeTtlSeconds / 60)} minutes.`);
}

module.exports = { normaliseAuMobile, maskMobile, sendSms, sendVerificationCode };
