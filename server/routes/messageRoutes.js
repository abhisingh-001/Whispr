const express = require('express');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { encryptForRecipient, wrapKeyForPublicKey } = require('../utils/secureCrypto');
const { sanitizeMessage } = require('./chatRoutes');

const router = express.Router();

const SELF_DESTRUCT_OPTIONS = new Set([30, 60, 300]); // 30s / 1min / 5min
const QUICK_REACTIONS = new Set(['❤️', '😂', '👍', '😮', '😢', '🔥']);

async function populateAndSanitize(messageDoc, viewerId) {
  const populated = await messageDoc.populate([
    { path: 'sender', select: 'fullName username avatarColor avatarImage' },
    {
      path: 'replyTo',
      select: 'content isSecure deleted sender',
      populate: { path: 'sender', select: 'fullName username' }
    }
  ]);
  return sanitizeMessage(populated, viewerId);
}

/**
 * POST /api/messages
 * body: { chatId, text, isSecure, recipientId (required if isSecure and group),
 *         selfDestructSeconds (optional, only meaningful if isSecure),
 *         replyTo (optional message id being replied to) }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { chatId, text, isSecure, recipientId, selfDestructSeconds, replyTo } = req.body;
    if (!chatId || !text || !text.trim()) {
      return res.status(400).json({ message: 'chatId and text are required.' });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.map(String).includes(req.userId)) {
      return res.status(403).json({ message: 'You are not part of this chat.' });
    }

    if (chat.isGroup && chat.announcementOnly && !chat.admins.map(String).includes(req.userId)) {
      return res.status(403).json({ message: 'Only group admins can post in this announcement-only group.' });
    }

    let replyToId = null;
    if (replyTo) {
      const original = await Message.findById(replyTo);
      if (original && String(original.chat) === String(chatId)) replyToId = original._id;
    }

    let messageDoc;

    if (isSecure) {
      // Figure out who the "lock" is for: in a 1:1 chat it's always the
      // other participant; in "Message Yourself" it's you; in a group the
      // sender must pick a recipient.
      let targetId = recipientId;
      if (chat.isSelfChat) {
        targetId = req.userId;
      } else if (!chat.isGroup) {
        targetId = chat.participants.map(String).find((id) => id !== req.userId);
      }
      if (!targetId) {
        return res.status(400).json({ message: 'A recipient is required for a Secure Message in a group.' });
      }

      const recipient = await User.findById(targetId);
      if (!recipient || !recipient.secureMessage?.enabled || !recipient.secureMessage?.publicKey) {
        return res.status(400).json({
          message: 'That user has not set up a Secure Message PIN yet, so a locked message cannot be sent to them.'
        });
      }

      const enc = encryptForRecipient(text.trim(), recipient.secureMessage.publicKey);

      // If the sender ALSO has a PIN set up (and isn't the same person as
      // the recipient, e.g. a self-chat, where encryptedKey already covers
      // this), wrap the same one-time message key for the sender's own
      // public key too - so they can look up what they sent later with
      // their own PIN. This never involves storing the raw message key or
      // the plaintext; it's just one more RSA-OAEP wrap of the same key.
      let encryptedKeyForSender = null;
      if (String(targetId) !== String(req.userId)) {
        const senderUser = await User.findById(req.userId).select('secureMessage.enabled secureMessage.publicKey');
        if (senderUser?.secureMessage?.enabled && senderUser.secureMessage.publicKey) {
          encryptedKeyForSender = wrapKeyForPublicKey(enc.messageKey, senderUser.secureMessage.publicKey);
        }
      }

      const destructSeconds =
        selfDestructSeconds && SELF_DESTRUCT_OPTIONS.has(Number(selfDestructSeconds))
          ? Number(selfDestructSeconds)
          : null;

      messageDoc = await Message.create({
        chat: chatId,
        sender: req.userId,
        isSecure: true,
        content: null,
        replyTo: replyToId,
        secure: {
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          encryptedKey: enc.encryptedKey,
          encryptedKeyForSender,
          garbledPreview: enc.garbledPreview,
          recipient: targetId
        },
        selfDestruct: {
          enabled: !!destructSeconds,
          durationSeconds: destructSeconds,
          unlockedAt: null,
          destroyed: false
        },
        readBy: [req.userId]
      });
      // text/plaintext and the raw message key are never referenced again
      // after this point - only their RSA-wrapped forms are kept.
    } else {
      messageDoc = await Message.create({
        chat: chatId,
        sender: req.userId,
        isSecure: false,
        content: text.trim(),
        replyTo: replyToId,
        readBy: [req.userId]
      });
    }

    chat.lastMessageAt = new Date();
    chat.hiddenFor = []; // a new message un-hides a previously "deleted" chat for everyone
    await chat.save();

    const safe = await populateAndSanitize(messageDoc, req.userId);

    req.app.get('io').to(String(chatId)).emit('message:new', safe);
    res.status(201).json({ message: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not send message.' });
  }
});

// POST /api/messages/:id/pin
router.post('/:id/pin', requireAuth, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });
  msg.pinned = true;
  msg.pinnedBy = req.userId;
  await msg.save();
  req.app.get('io').to(String(msg.chat)).emit('message:pinned', { id: msg._id, pinned: true, pinnedBy: req.userId });
  res.json({ ok: true });
});

// POST /api/messages/:id/unpin
router.post('/:id/unpin', requireAuth, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });
  msg.pinned = false;
  msg.pinnedBy = null;
  await msg.save();
  req.app.get('io').to(String(msg.chat)).emit('message:pinned', { id: msg._id, pinned: false });
  res.json({ ok: true });
});

// POST /api/messages/:id/react  { emoji }
// Toggles the current user's reaction with that emoji on/off.
router.post('/:id/react', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!QUICK_REACTIONS.has(emoji)) return res.status(400).json({ message: 'Unsupported reaction.' });

  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });

  let entry = msg.reactions.find((r) => r.emoji === emoji);
  const already = entry && entry.users.map(String).includes(req.userId);

  if (already) {
    entry.users = entry.users.filter((u) => String(u) !== req.userId);
    if (!entry.users.length) msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
  } else {
    if (!entry) {
      entry = { emoji, users: [] };
      msg.reactions.push(entry);
    }
    entry.users.push(req.userId);
  }
  await msg.save();

  const payload = {
    id: msg._id,
    reactions: msg.reactions.map((r) => ({ emoji: r.emoji, count: r.users.length }))
  };
  req.app.get('io').to(String(msg.chat)).emit('message:reaction', payload);
  res.json(payload);
});

// DELETE /api/messages/:id - soft delete, sender only
router.delete('/:id', requireAuth, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });
  if (String(msg.sender) !== String(req.userId)) {
    return res.status(403).json({ message: 'You can only delete your own messages.' });
  }

  msg.deleted = true;
  msg.content = null;
  if (msg.secure) {
    msg.secure.ciphertext = null;
    msg.secure.iv = null;
    msg.secure.authTag = null;
    msg.secure.encryptedKey = null;
    msg.secure.garbledPreview = null;
  }
  await msg.save();

  req.app.get('io').to(String(msg.chat)).emit('message:deleted', { id: msg._id });
  res.json({ ok: true });
});

// POST /api/messages/:id/self-destruct - called by the client once the
// countdown (started at unlock time) reaches zero.
router.post('/:id/self-destruct', requireAuth, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });

  msg.selfDestruct.destroyed = true;
  msg.content = null;
  if (msg.secure) {
    msg.secure.ciphertext = null;
    msg.secure.iv = null;
    msg.secure.authTag = null;
    msg.secure.encryptedKey = null;
    msg.secure.garbledPreview = '🔥 This message has self-destructed.';
  }
  await msg.save();

  req.app.get('io').to(String(msg.chat)).emit('message:destroyed', { id: msg._id });
  res.json({ ok: true });
});

module.exports = router;
