// ABN validation.
//
// This matters well beyond signup. An unquoted or invalid ABN changes withholding
// obligations, and TPAR reports every contractor payment BY ABN at year end. Storing
// an unchecked string now means reconstructing it next July, under time pressure,
// from records that no longer have the contractor on the phone.
//
// Two levels, and the caller records which one passed:
//   'checksum' — modulus 89, offline, always run
//   'abr'      — confirmed against the ABR register, only when ABR_GUID is set

const config = require('../config');

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Strip spaces and any non-digits. Returns null if the result is not 11 digits. */
function normaliseAbn(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

/**
 * ATO modulus-89 checksum.
 * Subtract 1 from the leading digit, apply the positional weights, sum, mod 89.
 */
function checksumValid(raw) {
  const abn = normaliseAbn(raw);
  if (!abn) return false;

  const digits = abn.split('').map(Number);
  digits[0] -= 1;

  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/**
 * Look the ABN up on the ABR register. Returns null when no GUID is configured,
 * on timeout, or on any error — the caller falls back to the checksum result.
 * A registry outage must never block a builder from signing up.
 */
async function abrLookup(raw) {
  const abn = normaliseAbn(raw);
  if (!abn || !config.abn.abrGuid) return null;

  try {
    const url = `${config.abn.abrUrl}?abn=${abn}&guid=${config.abn.abrGuid}&callback=cb`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(config.abn.timeoutMs) });
    if (!resp.ok) return null;

    // The ABR "json" endpoint actually returns JSONP: cb({...}).
    const text = await resp.text();
    const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\)[;\s]*$/, ''));

    if (!json.Abn) return null;
    return {
      abn: json.Abn,
      entityName: json.EntityName || null,
      status: json.AbnStatus || null,
      state: json.AddressState || null,
      postcode: json.AddressPostcode || null,
      gstRegistered: !!json.Gst,
    };
  } catch (err) {
    console.warn('[ABN] ABR lookup failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Validate an ABN as far as the environment allows.
 * → { abn, level: 'no'|'checksum'|'abr', details }
 */
async function validateAbn(raw) {
  const abn = normaliseAbn(raw);
  if (!abn || !checksumValid(abn)) {
    return { abn, level: 'no', details: null };
  }

  const details = await abrLookup(abn);
  if (details && details.status && /active/i.test(details.status)) {
    return { abn, level: 'abr', details };
  }
  return { abn, level: 'checksum', details };
}

module.exports = { normaliseAbn, checksumValid, abrLookup, validateAbn };
