const crypto = require('crypto');

/*
 * SECURE MESSAGE - ENCRYPTION DESIGN
 * ----------------------------------
 * Goal: sender can lock a message for a specific recipient at the moment
 * it's sent (recipient may be offline), but only that recipient's PIN can
 * ever unlock it. The server never stores the PIN or the plaintext.
 *
 * 1. PIN SETUP (per user, done once / whenever they change their PIN):
 *      - Generate an RSA-2048 keypair for the user.
 *      - Derive a wrapping key from  scrypt(PIN + SECURE_PEPPER, salt)
 *      - AES-256-GCM encrypt the RSA private key with that wrapping key.
 *      - Store: publicKey (plain), encryptedPrivateKey, iv, authTag, salt.
 *      - The PIN and the wrapping key are only ever held in memory for the
 *        duration of the request, then discarded.
 *
 * 2. SENDING a secure message to a recipient:
 *      - Generate a random one-time AES-256 "message key".
 *      - AES-256-GCM encrypt the plaintext with the message key.
 *      - RSA-OAEP encrypt the message key with the recipient's PUBLIC key.
 *      - Store ciphertext + iv + authTag + the RSA-wrapped message key.
 *      - Plaintext is discarded immediately after this function returns.
 *
 * 3. UNLOCKING (recipient enters PIN):
 *      - Re-derive the wrapping key from the entered PIN + stored salt.
 *      - Try to AES-256-GCM decrypt the stored private key.
 *          -> GCM's auth tag makes this fail loudly on a wrong PIN, so a
 *             wrong PIN can never partially succeed or leak information.
 *      - If it succeeds, RSA-decrypt the message key, then AES-256-GCM
 *        decrypt the message itself, and return the plaintext ONLY in the
 *        HTTP response for this one request. Nothing decrypted is ever
 *        written back to the database.
 */

const SCRYPT_KEYLEN = 32; // 256-bit key for AES-256

function getPepper() {
  return process.env.SECURE_PEPPER || 'whispr-default-pepper-change-me';
}

function deriveWrappingKey(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(pin) + getPepper(), salt, SCRYPT_KEYLEN);
}

/** Step 1: create a fresh keypair + PIN-wrapped private key for a user. */
function setupSecurePin(pin) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const salt = crypto.randomBytes(16);
  const wrappingKey = deriveWrappingKey(pin, salt.toString('hex'));

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    publicKey,
    encryptedPrivateKey: encrypted.toString('base64'),
    privateKeyIv: iv.toString('base64'),
    privateKeyAuthTag: authTag.toString('base64'),
    pinSalt: salt.toString('hex')
  };
}

/**
 * Attempt to unwrap a user's RSA private key with a candidate PIN.
 * Throws on a wrong PIN (GCM auth failure) - caller should treat any
 * thrown error as "wrong PIN", nothing more specific.
 */
function unwrapPrivateKey(pin, userSecureRecord) {
  const wrappingKey = deriveWrappingKey(pin, userSecureRecord.pinSalt);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    wrappingKey,
    Buffer.from(userSecureRecord.privateKeyIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(userSecureRecord.privateKeyAuthTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(userSecureRecord.encryptedPrivateKey, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8'); // PEM private key, kept only in memory
}

/** Step 2: encrypt a plaintext message once, then wrap its one-time key for
 * one or more public keys (the recipient, and optionally the sender too so
 * they can also review what they sent - see wrapKeyForPublicKey below). */
function encryptForRecipient(plaintext, recipientPublicKeyPem) {
  const messageKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', messageKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedKey = wrapKeyForPublicKey(messageKey, recipientPublicKeyPem);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptedKey,
    messageKey, // returned so the caller can also wrap it for a second party (e.g. the sender); never stored raw
    garbledPreview: buildGarbledPreview(ciphertext)
  };
}

/** Wrap an already-generated message key for an additional public key -
 * used so a sender who also has a PIN set up can wrap the SAME message key
 * for themselves, letting them unlock their own sent Secure Message later. */
function wrapKeyForPublicKey(messageKey, publicKeyPem) {
  return crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    messageKey
  ).toString('base64');
}

/** Step 3: decrypt a stored secure message once the private key is unwrapped.
 * `encryptedKeyBase64` is whichever wrapped copy matches the caller's own
 * private key (the recipient's copy, or the sender's own copy). */
function decryptWithPrivateKey(privateKeyPem, secureRecord, encryptedKeyBase64) {
  const messageKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(encryptedKeyBase64 || secureRecord.encryptedKey, 'base64')
  );

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    messageKey,
    Buffer.from(secureRecord.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(secureRecord.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secureRecord.ciphertext, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

// A deliberately "unreadable glyph" alphabet, similar to the look requested
// in the brief - purely cosmetic, derived from ciphertext bytes so length
// roughly tracks the real message but reveals nothing about its content.
const GLYPHS = 'ȺƁȼƉƎƑƓĦƗĴҠŁḾŇØƤɊŘŞȚŲṼŴXɎƵąɓȼđɇƒɠħɨʝƙłɱŋøƥɋřşŧųṽŵxɏƶ0123456789ǤǥȘșȚțŐő'.split('');

function buildGarbledPreview(ciphertextBuffer) {
  // Roughly mirror the message's length, capped for very long messages.
  const len = Math.max(6, Math.min(ciphertextBuffer.length, 40));
  let out = '';
  for (let i = 0; i < len; i++) {
    const b = ciphertextBuffer[i % ciphertextBuffer.length];
    out += GLYPHS[(b + i) % GLYPHS.length];
    if ((i + 1) % 4 === 0 && i !== len - 1) out += ' ';
  }
  return out;
}

/**
 * SECURE PIN VAULT
 * ----------------
 * A small, separate, OPTIONAL encrypted copy of the user's current Secure
 * Message PIN, so they can recover it if they forget it. Encrypted with a
 * key derived from the user's account password (scrypt) - never the
 * password itself, never the PIN in the clear. Unlocking always requires
 * the account password to be re-verified (bcrypt) by the caller first.
 */
function encryptVaultSecret(secret, accountPassword) {
  const salt = crypto.randomBytes(16);
  const key = deriveWrappingKey(accountPassword, salt.toString('hex'));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('hex')
  };
}

function decryptVaultSecret(accountPassword, vaultRecord) {
  const key = deriveWrappingKey(accountPassword, vaultRecord.salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(vaultRecord.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(vaultRecord.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(vaultRecord.ciphertext, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

module.exports = {
  setupSecurePin,
  unwrapPrivateKey,
  encryptForRecipient,
  wrapKeyForPublicKey,
  decryptWithPrivateKey,
  encryptVaultSecret,
  decryptVaultSecret
};
