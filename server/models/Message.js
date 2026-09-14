const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    isSecure: { type: Boolean, default: false },

    // Plain messages only. Left null for secure messages - plaintext is
    // NEVER written to the database for a secure message.
    content: { type: String, default: null },

    // Populated only when isSecure = true. All of this is meaningless
    // without the recipient's PIN (see server/utils/secureCrypto.js).
    secure: {
      ciphertext: { type: String, default: null }, // AES-256-GCM ciphertext (base64)
      iv: { type: String, default: null },
      authTag: { type: String, default: null },
      encryptedKey: { type: String, default: null }, // message key, RSA-OAEP wrapped for recipient
      encryptedKeyForSender: { type: String, default: null }, // same message key, wrapped for the sender's own PIN (optional)
      garbledPreview: { type: String, default: null }, // fixed cosmetic "locked" preview
      recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
    },

    selfDestruct: {
      enabled: { type: Boolean, default: false },
      durationSeconds: { type: Number, default: null },
      unlockedAt: { type: Date, default: null },
      destroyed: { type: Boolean, default: false }
    },

    pinned: { type: Boolean, default: false },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    deleted: { type: Boolean, default: false },

    // One entry per emoji used on this message, each holding the list of
    // users who reacted with it - lets us show "❤️ 2  👍 1" and toggle a
    // single user's own reaction on/off.
    reactions: [
      {
        emoji: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
      }
    ],

    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

// TTL-style cleanup helper index (actual deletion is handled explicitly by
// the self-destruct timer logic so we can broadcast the removal over the
// socket first - see server/socket/socketHandler.js).
messageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
