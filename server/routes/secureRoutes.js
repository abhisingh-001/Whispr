const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Message = require('../models/Message');
const requireAuth = require('../middleware/auth');
const {
  setupSecurePin,
  unwrapPrivateKey,
  decryptWithPrivateKey,
  encryptVaultSecret,
  decryptVaultSecret
} = require('../utils/secureCrypto');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 2 * 60 * 1000; // 2 minutes

function isPinFormatValid(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

// GET /api/secure/status
router.get('/status', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('secureMessage.enabled');
  res.json({ enabled: !!user.secureMessage?.enabled });
});

// POST /api/secure/setup  { pin, accountPassword? }
// Used for BOTH first-time setup and changing an existing PIN. The old
// PIN is not required to change it (same as a "forgot password" reset),
// but that also means anyone who can already reach this authenticated
// route can rotate the PIN - by design this only re-locks *future*
// messages, it never reveals anything already locked with the old PIN.
//
// If accountPassword is supplied and matches the account, this PIN is
// also saved into the Secure PIN Vault (encrypted with a key derived from
// that password) so it can be recovered later. If accountPassword is
// omitted or wrong, the PIN itself still saves fine - the vault is simply
// left disabled (any previous vault entry is cleared, since it would
// otherwise hold a now-stale PIN).
router.post('/setup', requireAuth, async (req, res) => {
  const { pin, accountPassword } = req.body;
  if (!isPinFormatValid(pin)) {
    return res.status(400).json({ message: 'PIN must be 4-8 digits.' });
  }

  const keys = setupSecurePin(pin);
  const user = await User.findById(req.userId);
  user.secureMessage = {
    enabled: true,
    publicKey: keys.publicKey,
    encryptedPrivateKey: keys.encryptedPrivateKey,
    privateKeyIv: keys.privateKeyIv,
    privateKeyAuthTag: keys.privateKeyAuthTag,
    pinSalt: keys.pinSalt,
    failedAttempts: 0,
    lockedUntil: null
  };

  let vaultSaved = false;
  if (accountPassword) {
    const ok = await bcrypt.compare(accountPassword, user.passwordHash);
    if (ok) {
      const vault = encryptVaultSecret(pin, accountPassword);
      user.pinVault = { enabled: true, ...vault };
      vaultSaved = true;
    } else {
      user.pinVault = { enabled: false, ciphertext: null, iv: null, authTag: null, salt: null };
    }
  } else {
    user.pinVault = { enabled: false, ciphertext: null, iv: null, authTag: null, salt: null };
  }

  await user.save();

  res.json({
    ok: true,
    message: 'Secure Message PIN saved.',
    vaultSaved,
    vaultSkipped: !!accountPassword && !vaultSaved
  });
});

// POST /api/secure/generate-pin - convenience: server proposes a random PIN
router.post('/generate-pin', requireAuth, async (req, res) => {
  const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  res.json({ pin });
});

/**
 * POST /api/secure/unlock  { messageId, pin }
 * Returns the decrypted plaintext ONLY in this response. Nothing is ever
 * persisted. A wrong PIN always returns the same generic error - there is
 * no hint whatsoever about the real content.
 */
router.post('/unlock', requireAuth, async (req, res) => {
  const { messageId, pin } = req.body;
  if (!messageId || !isPinFormatValid(pin)) {
    return res.status(400).json({ message: 'Wrong PIN.' });
  }

  const user = await User.findById(req.userId);
  const sm = user.secureMessage;

  if (sm?.lockedUntil && sm.lockedUntil > new Date()) {
    const secs = Math.ceil((sm.lockedUntil - new Date()) / 1000);
    return res.status(429).json({ message: `Too many attempts. Try again in ${secs}s.` });
  }

  const msg = await Message.findById(messageId);
  if (!msg || !msg.isSecure) {
    return res.status(404).json({ message: 'Wrong PIN.' });
  }

  // Two people may be able to unlock the same Secure Message: the intended
  // recipient (using their PIN-wrapped copy of the message key), or the
  // original sender - but only if they also have a PIN set up and a
  // sender-side copy of the key was saved when the message was sent (see
  // messageRoutes.js). Either way, the wrong-PIN failure looks identical.
  const isRecipient = String(msg.secure.recipient) === String(req.userId);
  const isSenderWithOwnCopy = String(msg.sender) === String(req.userId) && !!msg.secure.encryptedKeyForSender;
  if (!isRecipient && !isSenderWithOwnCopy) {
    return res.status(404).json({ message: 'Wrong PIN.' });
  }
  const encryptedKeyToUse = isRecipient ? msg.secure.encryptedKey : msg.secure.encryptedKeyForSender;

  if (msg.selfDestruct?.destroyed) {
    return res.status(410).json({ message: 'This message has self-destructed and no longer exists.' });
  }

  try {
    const privateKeyPem = unwrapPrivateKey(pin, sm);
    const plaintext = decryptWithPrivateKey(privateKeyPem, msg.secure, encryptedKeyToUse);

    // Correct PIN - reset the attempt counter.
    sm.failedAttempts = 0;
    sm.lockedUntil = null;
    await user.save();

    // If this message has a self-destruct timer, "starting" it just means
    // recording when it was first unlocked - the client drives the visible
    // countdown and calls /api/messages/:id/self-destruct when it hits 0.
    // Only the recipient unlocking should arm this countdown - the sender
    // peeking at their own copy shouldn't blow up the recipient's message.
    if (isRecipient && msg.selfDestruct?.enabled && !msg.selfDestruct.unlockedAt) {
      msg.selfDestruct.unlockedAt = new Date();
      await msg.save();
    }

    return res.json({
      plaintext,
      selfDestruct: msg.selfDestruct,
      // Only the recipient's own unlock should ever arm the countdown -
      // the sender peeking at their own sent copy must never trigger
      // deletion before the recipient has even seen it.
      armDestructTimer: isRecipient && !!msg.selfDestruct?.enabled && !msg.selfDestruct?.destroyed
    });
  } catch (err) {
    sm.failedAttempts = (sm.failedAttempts || 0) + 1;
    if (sm.failedAttempts >= MAX_ATTEMPTS) {
      sm.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      sm.failedAttempts = 0;
    }
    await user.save();
    // Deliberately generic - never reveals whether the PIN format, the
    // message, or anything else was the problem.
    return res.status(401).json({ message: 'Wrong PIN.' });
  }
});

// ---------------- Secure PIN Vault ----------------

// GET /api/secure/vault/status
router.get('/vault/status', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('pinVault.enabled secureMessage.enabled');
  res.json({
    pinConfigured: !!user.secureMessage?.enabled,
    vaultEnabled: !!user.pinVault?.enabled
  });
});

// POST /api/secure/vault/unlock  { accountPassword }
// Verifies the account password, then decrypts and returns the PIN - only
// in this one response. Nothing decrypted is ever persisted anywhere.
router.post('/vault/unlock', requireAuth, async (req, res) => {
  const { accountPassword } = req.body;
  if (!accountPassword) return res.status(400).json({ message: 'Account password is required.' });

  const user = await User.findById(req.userId);
  if (!user.pinVault?.enabled) {
    return res.status(404).json({ message: 'The Secure PIN Vault has not been set up yet.' });
  }

  const passwordOk = await bcrypt.compare(accountPassword, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ message: 'Incorrect password.' });
  }

  try {
    const pin = decryptVaultSecret(accountPassword, user.pinVault);
    return res.json({ pin });
  } catch (err) {
    // Should only happen if the password changed after the vault was
    // saved (the derived key would then differ) - ask them to re-save.
    return res.status(409).json({
      message: 'Could not unlock the vault - your account password may have changed since it was saved. Please re-save your PIN with your current password.'
    });
  }
});

module.exports = router;
