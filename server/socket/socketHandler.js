const jwt = require('jsonwebtoken');
const User = require('../models/User');

function registerSocketHandlers(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      next();
    } catch (err) {
      next(new Error('Unauthorized socket connection.'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    io.emit('presence:update', { userId, isOnline: true });

    socket.on('chat:join', (chatId) => {
      socket.join(String(chatId));
    });

    socket.on('chat:leave', (chatId) => {
      socket.leave(String(chatId));
    });

    socket.on('typing:start', ({ chatId }) => {
      socket.to(String(chatId)).emit('typing:start', { chatId, userId });
    });

    socket.on('typing:stop', ({ chatId }) => {
      socket.to(String(chatId)).emit('typing:stop', { chatId, userId });
    });

    socket.on('message:read', ({ chatId, messageId }) => {
      socket.to(String(chatId)).emit('message:read', { messageId, userId });
    });

    socket.on('disconnect', async () => {
      const lastSeen = new Date();
      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
      io.emit('presence:update', { userId, isOnline: false, lastSeen });
    });
  });
}

module.exports = registerSocketHandlers;
