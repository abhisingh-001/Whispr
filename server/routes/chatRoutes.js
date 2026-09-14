const express = require('express');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const PARTICIPANT_SELECT = 'fullName username avatarColor avatarImage isOnline lastSeen';

// Every user gets exactly one "Message Yourself" chat, created the first
// time they load their chat list (WhatsApp-style personal notes chat).
async function ensureSelfChat(userId) {
  let selfChat = await Chat.findOne({ isSelfChat: true, participants: [userId] });
  if (!selfChat) {
    selfChat = await Chat.create({
      isGroup: false,
      isSelfChat: true,
      participants: [userId],
      lastMessageAt: new Date()
    });
  }
  return selfChat;
}

// GET /api/chats - all chats the current user belongs to
router.get('/', requireAuth, async (req, res) => {
  await ensureSelfChat(req.userId);
  const chats = await Chat.find({ participants: req.userId, hiddenFor: { $ne: req.userId } })
    .populate('participants', PARTICIPANT_SELECT)
    .sort({ lastMessageAt: -1 });

  // Cheap flag for the "🔒 Secure" sidebar filter - which of these chats
  // has at least one (non-deleted) Secure Message in it.
  const secureChatIds = await Message.distinct('chat', {
    chat: { $in: chats.map((c) => c._id) },
    isSecure: true,
    deleted: false
  });
  const secureSet = new Set(secureChatIds.map(String));

  const withFlags = chats.map((c) => ({ ...c.toObject(), hasSecure: secureSet.has(String(c._id)) }));
  res.json({ chats: withFlags });
});

// DELETE /api/chats/:chatId - WhatsApp-style "delete chat": removes it from
// MY chat list only. It comes back automatically for everyone the moment
// a new message is sent in it (see messageRoutes.js).
router.delete('/:chatId', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.participants.map(String).includes(req.userId)) {
    return res.status(404).json({ message: 'Chat not found.' });
  }
  if (chat.isSelfChat) {
    return res.status(400).json({ message: 'The Message Yourself chat can\'t be deleted.' });
  }
  if (!chat.hiddenFor.map(String).includes(req.userId)) {
    chat.hiddenFor.push(req.userId);
    await chat.save();
  }
  res.json({ ok: true });
});

// POST /api/chats/direct  { userId }
router.post('/direct', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId is required.' });

  let chat = await Chat.findOne({
    isGroup: false,
    isSelfChat: false,
    participants: { $all: [req.userId, userId], $size: 2 }
  }).populate('participants', PARTICIPANT_SELECT);

  if (!chat) {
    chat = await Chat.create({
      isGroup: false,
      participants: [req.userId, userId]
    });
    chat = await chat.populate('participants', PARTICIPANT_SELECT);
  }

  res.json({ chat });
});

// POST /api/chats/group  { groupName, participantIds: [] }
router.post('/group', requireAuth, async (req, res) => {
  const { groupName, participantIds } = req.body;
  if (!groupName || !Array.isArray(participantIds) || participantIds.length < 1) {
    return res.status(400).json({ message: 'groupName and at least one participant are required.' });
  }

  const participants = Array.from(new Set([req.userId, ...participantIds]));
  let chat = await Chat.create({
    isGroup: true,
    groupName,
    participants,
    admin: req.userId,
    admins: [req.userId]
  });
  chat = await chat.populate('participants', PARTICIPANT_SELECT);

  res.status(201).json({ chat });
});

function requireGroupAdmin(chat, userId) {
  return chat.isGroup && chat.admins.map(String).includes(String(userId));
}

// PATCH /api/chats/:chatId  { groupName?, groupAvatarImage?, announcementOnly? }
// Admin-only group settings.
router.patch('/:chatId', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: 'Group not found.' });
  if (!requireGroupAdmin(chat, req.userId)) {
    return res.status(403).json({ message: 'Only group admins can change these settings.' });
  }

  const { groupName, groupAvatarImage, announcementOnly } = req.body;
  if (typeof groupName === 'string' && groupName.trim()) chat.groupName = groupName.trim();
  if (typeof groupAvatarImage !== 'undefined') chat.groupAvatarImage = groupAvatarImage;
  if (typeof announcementOnly === 'boolean') chat.announcementOnly = announcementOnly;
  await chat.save();

  const populated = await chat.populate('participants', PARTICIPANT_SELECT);
  req.app.get('io').to(String(chat._id)).emit('chat:updated', populated);
  res.json({ chat: populated });
});

// POST /api/chats/:chatId/members  { userId }  - admin only
router.post('/:chatId/members', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: 'Group not found.' });
  if (!requireGroupAdmin(chat, req.userId)) {
    return res.status(403).json({ message: 'Only group admins can add members.' });
  }
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId is required.' });
  if (!chat.participants.map(String).includes(String(userId))) {
    chat.participants.push(userId);
    await chat.save();
  }
  const populated = await chat.populate('participants', PARTICIPANT_SELECT);
  req.app.get('io').to(String(chat._id)).emit('chat:updated', populated);
  res.json({ chat: populated });
});

// DELETE /api/chats/:chatId/members/:userId - admin only
router.delete('/:chatId/members/:userId', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: 'Group not found.' });
  if (!requireGroupAdmin(chat, req.userId)) {
    return res.status(403).json({ message: 'Only group admins can remove members.' });
  }
  chat.participants = chat.participants.filter((p) => String(p) !== String(req.params.userId));
  chat.admins = chat.admins.filter((a) => String(a) !== String(req.params.userId));
  await chat.save();
  const populated = await chat.populate('participants', PARTICIPANT_SELECT);
  req.app.get('io').to(String(chat._id)).emit('chat:updated', populated);
  res.json({ chat: populated });
});

// POST /api/chats/:chatId/admins/:userId - promote - admin only
router.post('/:chatId/admins/:userId', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: 'Group not found.' });
  if (!requireGroupAdmin(chat, req.userId)) {
    return res.status(403).json({ message: 'Only group admins can promote members.' });
  }
  if (!chat.admins.map(String).includes(req.params.userId)) {
    chat.admins.push(req.params.userId);
    await chat.save();
  }
  const populated = await chat.populate('participants', PARTICIPANT_SELECT);
  req.app.get('io').to(String(chat._id)).emit('chat:updated', populated);
  res.json({ chat: populated });
});

// DELETE /api/chats/:chatId/admins/:userId - demote - admin only
router.delete('/:chatId/admins/:userId', requireAuth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: 'Group not found.' });
  if (!requireGroupAdmin(chat, req.userId)) {
    return res.status(403).json({ message: 'Only group admins can demote other admins.' });
  }
  chat.admins = chat.admins.filter((a) => String(a) !== String(req.params.userId));
  await chat.save();
  const populated = await chat.populate('participants', PARTICIPANT_SELECT);
  req.app.get('io').to(String(chat._id)).emit('chat:updated', populated);
  res.json({ chat: populated });
});

// GET /api/chats/:chatId/messages
router.get('/:chatId/messages', requireAuth, async (req, res) => {
  const messages = await Message.find({ chat: req.params.chatId })
    .populate('sender', 'fullName username avatarColor avatarImage')
    .populate({
      path: 'replyTo',
      select: 'content isSecure deleted sender',
      populate: { path: 'sender', select: 'fullName username' }
    })
    .sort({ createdAt: 1 });

  // Never leak raw secure fields to the client - only what's needed to
  // render a locked bubble. The actual decrypt happens via /api/secure/unlock.
  const safe = messages.map((m) => sanitizeMessage(m, req.userId));
  res.json({ messages: safe });
});

function sanitizeMessage(m, viewerId) {
  const base = {
    id: m._id,
    chat: m.chat,
    sender: m.sender,
    isSecure: m.isSecure,
    deleted: m.deleted,
    content: m.deleted ? null : (m.isSecure ? null : m.content),
    pinned: m.pinned,
    pinnedBy: m.pinnedBy,
    createdAt: m.createdAt,
    selfDestruct: m.selfDestruct,
    reactions: (m.reactions || []).map((r) => ({
      emoji: r.emoji,
      count: r.users.length,
      reactedByMe: r.users.map(String).includes(String(viewerId))
    })),
    replyTo: m.replyTo
      ? {
          id: m.replyTo._id,
          sender: m.replyTo.sender,
          isSecure: m.replyTo.isSecure,
          deleted: m.replyTo.deleted,
          preview: m.replyTo.deleted ? 'This message was deleted' : (m.replyTo.isSecure ? '🔒 Secure Message' : m.replyTo.content)
        }
      : null
  };
  if (m.isSecure && !m.deleted) {
    const isRecipient = String(m.secure.recipient) === String(viewerId);
    const isSender = String(m.sender._id || m.sender) === String(viewerId);
    base.secure = {
      garbledPreview: m.secure.garbledPreview,
      recipient: m.secure.recipient,
      isRecipient,
      // The sender can also unlock their own sent Secure Message, but only
      // if a sender-side wrapped copy of the key was saved (i.e. the
      // sender had their own PIN set up at send time - see messageRoutes.js).
      canUnlock: isRecipient || (isSender && !!m.secure.encryptedKeyForSender)
    };
  }
  return base;
}

module.exports = router;
module.exports.sanitizeMessage = sanitizeMessage;
module.exports.ensureSelfChat = ensureSelfChat;
