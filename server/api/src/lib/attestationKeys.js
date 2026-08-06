// Per-org Ed25519 attestation-signing keypair (PM2-02, projman-02 §10.1, migration
// v027). Server-generated, private half envelope-encrypted at rest; public half
// freely distributable for signature verification.
//
// Generated LAZILY on first use, not literally "at org creation" as originally
// worded — an org that never emits an attestation carries no key material at all,
// and this is otherwise identical: every org gets exactly one keypair, generated
// once, before its first signature.

const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');

// Envelope encryption needs a 32-byte AES-256 key. The configured master key is an
// arbitrary string (env var), so it is normalised through SHA-256 rather than
// assumed to already be exactly 32 bytes.
function masterKeyBytes() {
  const raw = config.attestation.masterKey || config.jwt.secret;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptPrivateKey(privateKeyPem) {
  const key = masterKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKeyPem, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv : authTag : ciphertext, each base64, colon-joined — one TEXT column, no new table.
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPrivateKey(encryptedBlob) {
  const [ivB64, tagB64, dataB64] = String(encryptedBlob).split(':');
  const key = masterKeyBytes();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Returns { publicKeyPem, privateKeyPem } for the org, generating+storing on first call. */
async function getOrCreateOrgKeypair(orgId) {
  const [[row]] = await pool.query(
    `SELECT attestation_key_public, attestation_key_encrypted FROM organisations WHERE id = ? LIMIT 1`,
    [orgId]
  );
  if (!row) throw new Error(`Organisation ${orgId} not found`);

  if (row.attestation_key_public && row.attestation_key_encrypted) {
    return {
      publicKeyPem: row.attestation_key_public,
      privateKeyPem: decryptPrivateKey(row.attestation_key_encrypted),
    };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  await pool.query(
    `UPDATE organisations
        SET attestation_key_public = ?, attestation_key_encrypted = ?, attestation_key_created_at = NOW()
      WHERE id = ?`,
    [publicKeyPem, encryptPrivateKey(privateKeyPem), orgId]
  );
  return { publicKeyPem, privateKeyPem };
}

/** Sign `data` (a string — the caller decides what gets serialised) with the org's key. */
async function sign(orgId, data) {
  const { privateKeyPem } = await getOrCreateOrgKeypair(orgId);
  return crypto.sign(null, Buffer.from(data, 'utf8'), privateKeyPem).toString('base64');
}

/** Verify `signature` (base64) against `data` using the org's stored public key. */
async function verify(orgId, data, signature) {
  const [[row]] = await pool.query(
    `SELECT attestation_key_public FROM organisations WHERE id = ? LIMIT 1`, [orgId]
  );
  if (!row?.attestation_key_public) return false;
  try {
    return crypto.verify(
      null, Buffer.from(data, 'utf8'), row.attestation_key_public, Buffer.from(signature, 'base64')
    );
  } catch {
    return false;
  }
}

module.exports = { getOrCreateOrgKeypair, sign, verify };
