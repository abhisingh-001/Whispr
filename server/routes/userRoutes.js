const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const PROFILE_SELECT =
  '-passwordHash -secureMessage.encryptedPrivateKey -secureMessage.privateKeyIv -secureMessage.privateKeyAuthTag -secureMessage.pinSalt -pinVault.ciphertext -pinVault.iv -pinVault.authTag -pinVault.salt';

const DIRECTORY_SELECT = 'fullName username avatarColor avatarImage isOnline lastSeen';

// Roughly 2MB of actual image bytes once decoded from base64.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select(PROFILE_SELECT);
  res.json({ user });
});

// PATCH /api/users/me/avatar  { imageDataUrl: "data:image/png;base64,...." }
router.patch('/me/avatar', requireAuth, async (req, res) => {
  const { imageDataUrl } = req.body;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl || '');
  if (!match) {
    return res.status(400).json({ message: 'Please upload a PNG, JPEG, WEBP or GIF image.' });
  }
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  if (!ALLOWED_AVATAR_TYPES.includes(mimeType)) {
    return res.status(400).json({ message: 'Unsupported image type.' });
  }

  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes > MAX_AVATAR_BYTES) {
    return res.status(400).json({ message: 'Image is too large. Please use a picture under 2MB.' });
  }

  const user = await User.findByIdAndUpdate(
    req.userId,
    { avatarImage: imageDataUrl },
    { new: true }
  ).select(PROFILE_SELECT);

  req.app.get('io').emit('user:avatar-updated', { userId: req.userId, avatarImage: user.avatarImage });
  res.json({ user });
});

// DELETE /api/users/me/avatar - fall back to the initials avatar
router.delete('/me/avatar', requireAuth, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.userId, { avatarImage: null }, { new: true }).select(PROFILE_SELECT);
  req.app.get('io').emit('user:avatar-updated', { userId: req.userId, avatarImage: null });
  res.json({ user });
});

// GET /api/users/search?q=abhi
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().replace(/^@/, '');
  if (!q) return res.json({ users: [] });

  const users = await User.find({
    _id: { $ne: req.userId },
    $or: [
      { username: new RegExp(q, 'i') },
      { fullName: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') }
    ]
  })
    .select(DIRECTORY_SELECT)
    .limit(15);

  res.json({ users });
});

// GET /api/users/all (used to populate "start new chat" list)
router.get('/all', requireAuth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.userId } })
    .select(DIRECTORY_SELECT)
    .limit(50);
  res.json({ users });
});

module.exports = router;
