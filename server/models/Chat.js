const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    isSelfChat: { type: Boolean, default: false }, // WhatsApp-style "Message Yourself"
    groupName: { type: String, default: null },
    groupAvatarColor: { type: String, default: '#F2B84B' },
    groupAvatarImage: { type: String, default: null },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // original creator
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // full admin list, creator included
    announcementOnly: { type: Boolean, default: false }, // only admins can post
    // WhatsApp-style "delete chat": hides it from that person's own list
    // only. It reappears for everyone automatically the moment a new
    // message is sent (see messageRoutes.js).
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastMessageAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chat', chatSchema);
