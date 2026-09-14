const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

const PALETTE = ['#6C8CFF', '#F2B84B', '#4FD1A5', '#F2789F', '#8C7CF0', '#4BB6F2'];
function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

// Instagram-style handle rules: 3-20 chars, letters, numbers, underscore
// only (no dots, no spaces). Stored lowercase so @Abhishek01 and
// @abhishek01 are always treated as the exact same, unique account.
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// GET /api/auth/check-username?username=abhishek
// Used by the registration form for live "username already taken" feedback.
router.get('/check-username', async (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return res.json({ available: false, reason: 'invalid' });
  }
  const existing = await User.findOne({ username });
  res.json({ available: !existing, reason: existing ? 'taken' : null });
});

router.post('/register', async (req, res) => {
  try {
    const { fullName, username, email, password } = req.body;
    if (!fullName || !username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      return res.status(400).json({
        message: 'Username must be 3-20 characters: letters, numbers and underscores only, no spaces.'
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    // Checked separately so the person is told exactly which field is the
    // problem, the way Instagram/other platforms do.
    const usernameTaken = await User.findOne({ username: cleanUsername });
    if (usernameTaken) {
      return res.status(409).json({ message: 'That username is already taken. Please choose another.', field: 'username' });
    }
    const emailTaken = await User.findOne({ email: email.toLowerCase() });
    if (emailTaken) {
      return res.status(409).json({ message: 'An account with that email already exists.', field: 'email' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      fullName,
      username: cleanUsername,
      email: email.toLowerCase(),
      passwordHash,
      avatarColor: randomColor()
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body; // identifier = username or email
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Username/email and password are required.' });
    }

    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }]
    });
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials.' });

    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed.' });
  }
});

function publicUser(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    avatarColor: user.avatarColor,
    avatarImage: user.avatarImage || null,
    secureMessageEnabled: !!user.secureMessage?.enabled
  };
}

module.exports = router;
