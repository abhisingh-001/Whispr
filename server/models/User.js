const mongoose = require('mongoose');

/*
 * Secure Message key material (see server/utils/secureCrypto.js for the full
 * scheme). Nothing here ever holds the user's PIN or any message plaintext:
 *
 *  - publicKey            : RSA public key, safe to store in the clear.
 *  - encryptedPrivateKey   : the RSA private key, AES-256-GCM encrypted with
 *                            a key derived from the PIN (scrypt). Useless
 *                            without the PIN.
 *  - privateKeyIv / privateKeyAuthTag / pinSalt : parameters needed to
 *                            re-derive the wrapping key and decrypt, but
 *                            useless on their own.
 *
 * There is deliberately no "pinHash" field. Correctness of a PIN is proven
 * by whether it successfully decrypts encryptedPrivateKey (GCM auth tag
 * check) - so we never need to store the PIN or a verifier for it at all.
 */
const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    avatarColor: { type: String, default: '#6C8CFF' },
    avatarImage: { type: String, default: null }, // base64 data URI, or null -> initials fallback

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    activityStatus: { type: String, default: null }, // transient: 'typing' | 'recording', per-chat state lives in memory (socket layer), this is a fallback

    // Secure Message key material - see note above.
    secureMessage: {
      enabled: { type: Boolean, default: false },
      publicKey: { type: String, default: null },
      encryptedPrivateKey: { type: String, default: null },
      privateKeyIv: { type: String, default: null },
      privateKeyAuthTag: { type: String, default: null },
      pinSalt: { type: String, default: null },
      failedAttempts: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null }
    },

    // Secure PIN Vault - an OPTIONAL, separate encrypted copy of the current
    // Secure Message PIN, so the user can look it up again if they forget
    // it. It is encrypted with a key derived from the user's account
    // password (never the password itself, and never the PIN in the
    // clear) - see server/utils/secureCrypto.js encryptVaultSecret /
    // decryptVaultSecret. Unlocking it requires re-entering the account
    // password, verified against passwordHash before any decrypt attempt.
    pinVault: {
      enabled: { type: Boolean, default: false },
      ciphertext: { type: String, default: null },
      iv: { type: String, default: null },
      authTag: { type: String, default: null },
      salt: { type: String, default: null }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
