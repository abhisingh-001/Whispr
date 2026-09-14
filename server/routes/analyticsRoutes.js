const express = require('express');
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GET /api/analytics/me
router.get('/me', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.userId);

  const chats = await Chat.find({ participants: userId });
  const chatIds = chats.map((c) => c._id);
  const activeChats = chats.filter((c) => !c.isGroup).length;
  const groups = chats.filter((c) => c.isGroup).length;

  const [sentCount, receivedCount, byDay] = await Promise.all([
    Message.countDocuments({ sender: userId }),
    Message.countDocuments({ chat: { $in: chatIds }, sender: { $ne: userId } }),
    Message.aggregate([
      { $match: { chat: { $in: chatIds } } },
      { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ])
  ]);

  let mostActiveDay = 'Not enough data yet';
  if (byDay.length) {
    // Mongo's $dayOfWeek: 1 = Sunday ... 7 = Saturday
    mostActiveDay = DAY_NAMES[byDay[0]._id - 1];
  }

  res.json({
    messagesSent: sentCount,
    messagesReceived: receivedCount,
    activeChats,
    groups,
    mostActiveDay
  });
});

module.exports = router;
