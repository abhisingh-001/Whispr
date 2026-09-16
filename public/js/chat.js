(function () {
  const {
    api, getUser, getToken, clearSession, getSmartReplies, translateText, getTargetLang, setTargetLang,
    paintAvatar, escapeHtml, showOverlay, hideOverlay
  } = window.Whispr;

  if (!getToken()) { window.location.href = '/index.html'; return; }

  const me = getUser();
  let socket = null;
  let chats = [];
  let activeChat = null;
  let usersOnline = {};       // userId -> bool
  let typingChats = new Set(); // chatIds where someone else is currently typing
  let lastIncomingText = '';   // for smart replies
  let pendingReply = null;     // message being replied to
  let pendingForward = null;   // message being forwarded
  const myReactions = {};      // msgId -> Set(emoji) the current user picked

  const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

  // ---------------- helpers ----------------
  function otherParticipant(chat) {
    if (chat.isGroup || chat.isSelfChat) return null;
    return chat.participants.find((p) => String(p._id || p.id) !== String(me.id));
  }
  function chatDisplayName(chat) {
    if (chat.isSelfChat) return 'Message Yourself';
    if (chat.isGroup) return chat.groupName;
    const other = otherParticipant(chat);
    return other ? other.fullName : 'Unknown';
  }
  function chatAvatarInfo(chat) {
    if (chat.isSelfChat) return { name: me.fullName, color: me.avatarColor, image: me.avatarImage };
    if (chat.isGroup) return { name: chat.groupName, color: chat.groupAvatarColor || '#F2B84B', image: chat.groupAvatarImage };
    const other = otherParticipant(chat);
    return other ? { name: other.fullName, color: other.avatarColor, image: other.avatarImage } : { name: '?', color: '#6C8CFF', image: null };
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function formatLastSeen(iso) {
    if (!iso) return 'a while ago';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  function draftKey(chatId) { return 'whispr-draft-' + chatId; }

  // ---------------- profile / sidebar footer ----------------
  document.getElementById('my-name').textContent = me.fullName;
  document.getElementById('my-username').textContent = '@' + me.username;
  paintAvatar(document.getElementById('my-avatar'), { name: me.fullName, color: me.avatarColor, image: me.avatarImage });

  window.Whispr.onMyAvatarChanged = (avatarImage) => {
    me.avatarImage = avatarImage;
    renderChatList();
    if (activeChat) renderChatHeader();
  };

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const ok = await window.Whispr.confirmAction({
      title: 'Log out of Whispr?',
      message: 'You\'ll need to log in again to access your chats on this device.',
      confirmLabel: 'Log out'
    });
    if (!ok) return;
    clearSession();
    if (socket) socket.disconnect();
    window.location.href = '/index.html';
  });

  document.getElementById('my-avatar').addEventListener('click', () => showOverlay('settings-overlay'));

  // ---------------- socket ----------------
  
  function connectSocket() {
    socket = io({ auth: { token: getToken() } });

    socket.on('presence:update', ({ userId, isOnline }) => {
      usersOnline[userId] = isOnline;
      renderChatList();
      if (activeChat) renderChatHeader();
    });

    socket.on('message:new', async (msg) => {
      let chat = chats.find((c) => String(c._id) === String(msg.chat));
      const isMine = String(msg.sender._id || msg.sender) === String(me.id);
      const isOpenChat = activeChat && String(activeChat._id) === String(msg.chat);

      if (!chat) {
        await loadChats(); 
        chat = chats.find((c) => String(c._id) === String(msg.chat)); 
      }

      if (chat) {
        chat.lastMessageAt = msg.createdAt;
        chat._preview = previewFor(msg);
        if (msg.isSecure) chat.hasSecure = true;
        if (!isMine && !isOpenChat) chat._unread = (chat._unread || 0) + 1;
        
        const searchInput = document.getElementById('chat-search');
        renderChatList(searchInput ? searchInput.value : '');
      }

      if (isOpenChat) {
        renderIfNew(msg, true);
        
        
        if (!isMine) {
          socket.emit('message:read', { chatId: msg.chat, messageId: msg.id || msg._id });
        }

        if (!isMine && !msg.isSecure) {
          lastIncomingText = msg.content || '';
          renderSmartReplies();
        }
      } else if (!isMine) {
        toast(`New message from ${msg.sender.fullName || 'someone'}`);
      }
    });

    socket.on('message:pinned', ({ id, pinned }) => {
      const el = document.querySelector(`[data-msg-id="${id}"]`);
      if (el) el.dataset.pinned = pinned ? '1' : '0';
      if (activeChat) loadPinnedBar();
    });

    socket.on('message:destroyed', ({ id }) => {
      const bubble = document.querySelector(`[data-msg-id="${id}"] .bubble`);
      if (bubble) {
        bubble.innerHTML = '<span class="lock-row">🔥 This message has self-destructed.</span>';
        bubble.classList.remove('secure-locked', 'secure-unlocked');
      }
    });

    socket.on('message:deleted', ({ id }) => {
      const bubble = document.querySelector(`[data-msg-id="${id}"] .bubble`);
      if (bubble) {
        bubble.innerHTML = '<span class="lock-row">🗑 This message was deleted.</span>';
        bubble.classList.add('deleted');
        bubble.classList.remove('secure-locked', 'secure-unlocked');
      }
    });

    socket.on('message:reaction', ({ id, reactions }) => {
      const row = document.querySelector(`[data-msg-id="${id}"]`);
      if (row) renderReactionBar(row.querySelector('.bubble'), id, reactions);
    });

    socket.on('chat:updated', (updatedChat) => {
      const idx = chats.findIndex((c) => String(c._id) === String(updatedChat._id));
      if (idx > -1) chats[idx] = updatedChat; else chats.unshift(updatedChat);
      if (activeChat && String(activeChat._id) === String(updatedChat._id)) {
        activeChat = updatedChat;
        renderChatHeader();
      }
      renderChatList();
      if (window.Whispr.onGroupUpdated) window.Whispr.onGroupUpdated(updatedChat);
    });

    socket.on('user:avatar-updated', ({ userId, avatarImage }) => {
      chats.forEach((chat) => {
        chat.participants.forEach((p) => { if (String(p._id || p.id) === String(userId)) p.avatarImage = avatarImage; });
      });
      renderChatList();
      if (activeChat) renderChatHeader();
    });

    socket.on('typing:start', ({ chatId, userId }) => {
      if (userId === me.id) return;
      typingChats.add(String(chatId));
      if (activeChat && String(activeChat._id) === String(chatId)) renderChatHeader();
    });
    
    socket.on('typing:stop', ({ chatId }) => {
      typingChats.delete(String(chatId));
      if (activeChat && String(activeChat._id) === String(chatId)) renderChatHeader();
    });

    // ================= PRO LEVEL BLUE TICK LISTENER =================
    socket.on('message:read', ({ messageId }) => {
      const row = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (row) {
        const tickSpan = row.querySelector('.ticks');
        if (tickSpan) {
          tickSpan.innerHTML = '✓✓'; // Double tick
          tickSpan.style.color = '#4da6ff'; // Blue color
          tickSpan.style.letterSpacing = '-2px';
        }
      }
    });
    
  }

  function previewFor(msg) {
    if (msg.deleted) return 'This message was deleted';
    if (msg.isSecure) return '🔒 Secure Message';
    return msg.content || '';
  }

  // Single choke point for "should this message actually be appended to
  // the DOM right now" - used by BOTH the optimistic render after sending
  // and the 'message:new' socket handler, since either one can win the
  // race to arrive first. Whichever runs second sees the row already
  // exists and does nothing, so exactly one copy is ever rendered.
  function renderIfNew(msg, scrollDown) {
    const msgId = msg.id || msg._id;
    if (document.querySelector(`[data-msg-id="${msgId}"]`)) return;
    appendMessage(msg, scrollDown);
  }

  // ---------------- load chats ----------------
  async function loadChats() {
    const { chats: list } = await api('/chats');
    chats = list;
    renderChatList();
  }

  let currentCategoryFilter = 'all';

  function matchesCategory(chat) {
    if (currentCategoryFilter === 'unread') return (chat._unread || 0) > 0;
    if (currentCategoryFilter === 'groups') return !!chat.isGroup;
    if (currentCategoryFilter === 'secure') return !!chat.hasSecure;
    return true;
  }

  function renderChatList(filter) {
    const container = document.getElementById('chat-list');
    container.innerHTML = '';
    const f = (filter || '').toLowerCase().replace(/^@/, '');

    const sorted = [...chats].sort((a, b) => {
      if (a.isSelfChat) return -1;
      if (b.isSelfChat) return 1;
      return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
    });

    sorted
      .filter((c) => matchesCategory(c) && (!f || chatDisplayName(c).toLowerCase().includes(f)))
      .forEach((chat) => {
        const item = document.createElement('div');
        item.className = 'chat-item' + (activeChat && String(activeChat._id) === String(chat._id) ? ' active' : '');

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        paintAvatar(avatar, chatAvatarInfo(chat));
        if (!chat.isGroup && !chat.isSelfChat) {
          const other = otherParticipant(chat);
          const online = other && usersOnline[other._id || other.id];
          const dot = document.createElement('span');
          dot.className = 'dot' + (online ? ' on' : '');
          avatar.appendChild(dot);
        }

        const meta = document.createElement('div');
        meta.className = 'chat-item-meta';
        const previewText = chat.isSelfChat ? ('@' + me.username) : (chat._preview || (chat.isGroup ? 'Group chat' : 'Say hi 👋'));
        meta.innerHTML = `<div class="name">${escapeHtml(chatDisplayName(chat))}</div><div class="preview">${escapeHtml(previewText)}</div>`;

        item.appendChild(avatar);
        item.appendChild(meta);

        if (chat._unread > 0) {
          const badge = document.createElement('span');
          badge.className = 'unread-badge';
          badge.textContent = chat._unread > 9 ? '9+' : String(chat._unread);
          item.appendChild(badge);
          meta.querySelector('.name').style.fontWeight = '700';
        }

        if (!chat.isSelfChat) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'chat-delete-btn';
          deleteBtn.title = 'Delete chat';
          deleteBtn.setAttribute('aria-label', 'Delete chat');
          deleteBtn.textContent = '🗑';
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChat(chat);
          });
          item.appendChild(deleteBtn);
        }

        item.addEventListener('click', () => openChat(chat));
        container.appendChild(item);
      });
  }

  document.getElementById('chat-search').addEventListener('input', (e) => renderChatList(e.target.value));

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategoryFilter = tab.dataset.filter;
      renderChatList(document.getElementById('chat-search').value);
    });
  });

  async function deleteChat(chat) {
    const ok = await window.Whispr.confirmAction({
      title: 'Delete this chat?',
      message: `This removes "${chatDisplayName(chat)}" from your chat list. It'll come back if a new message arrives.`,
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api(`/chats/${chat._id}`, { method: 'DELETE' });
      chats = chats.filter((c) => String(c._id) !== String(chat._id));
      if (activeChat && String(activeChat._id) === String(chat._id)) {
        activeChat = null;
        document.getElementById('active-chat').style.display = 'none';
        document.getElementById('no-chat-selected').style.display = 'flex';
      }
      renderChatList(document.getElementById('chat-search').value);
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------------- open a chat ----------------
  let openChatRequestId = 0; // guards against out-of-order responses when switching chats fast

  async function openChat(chat) {
    activeChat = chat;
    chat._unread = 0;
    document.getElementById('chat-search').value = '';
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('active-chat').style.display = 'flex';
    document.getElementById('sidebar').classList.add('hide');
    document.getElementById('back-btn').style.display = 'inline-flex';
    clearReply();

    renderChatHeader();
    renderChatList();
    socket.emit('chat:join', chat._id);

    const requestId = ++openChatRequestId;
    const { messages } = await api(`/chats/${chat._id}/messages`);

    // If the user switched to a different chat while this request was in
    // flight, this response is stale - drop it instead of overwriting
    // whatever chat is actually open now.
    if (requestId !== openChatRequestId || !activeChat || String(activeChat._id) !== String(chat._id)) return;

    const container = document.getElementById('messages');
    container.innerHTML = '';
    messages.forEach((m) => {
      appendMessage(m, false);
      
      const isMine = String(m.sender._id || m.sender) === String(me.id);
      if (!isMine) {
        socket.emit('message:read', { chatId: chat._id, messageId: m.id || m._id });
      }
    });
    container.scrollTop = container.scrollHeight;

    const lastIncoming = [...messages].reverse().find((m) => String(m.sender._id || m.sender) !== String(me.id) && !m.isSecure && !m.deleted);
    lastIncomingText = lastIncoming ? lastIncoming.content : '';
    renderSmartReplies();

    loadPinnedBar();

    const messageInput = document.getElementById('message-input');
    messageInput.value = localStorage.getItem(draftKey(chat._id)) || '';
  }

  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('hide');
  });

  function renderChatHeader() {
    const info = chatAvatarInfo(activeChat);
    paintAvatar(document.getElementById('header-avatar'), info);
    document.getElementById('header-name').textContent = chatDisplayName(activeChat);

    const statusEl = document.getElementById('header-status');
    if (activeChat.isSelfChat) {
      statusEl.textContent = 'Notes to self · @' + me.username;
      statusEl.className = 'status';
    } else if (activeChat.isGroup) {
      statusEl.textContent = `${activeChat.participants.length} members${activeChat.announcementOnly ? ' · 📢 Announcements only' : ''}`;
      statusEl.className = 'status';
    } else {
      const other = otherParticipant(activeChat);
      const isTyping = typingChats.has(String(activeChat._id));
      if (isTyping) {
        statusEl.textContent = 'typing…';
        statusEl.className = 'status status-typing';
      } else if (other && usersOnline[other._id || other.id]) {
        statusEl.textContent = '🟢 Online';
        statusEl.className = 'status status-online';
      } else {
        statusEl.textContent = other ? `Last seen ${formatLastSeen(other.lastSeen)}` : '';
        statusEl.className = 'status status-offline';
      }
    }
  }

  function openContactInfo(chat) {
    const other = otherParticipant(chat);
    if (!other) return;
    paintAvatar(document.getElementById('contact-info-avatar'), { name: other.fullName, color: other.avatarColor, image: other.avatarImage });
    document.getElementById('contact-info-name').textContent = other.fullName;
    document.getElementById('contact-info-username').textContent = '@' + other.username;
    const online = usersOnline[other._id || other.id];
    document.getElementById('contact-info-status').textContent = online ? '🟢 Online' : `Last seen ${formatLastSeen(other.lastSeen)}`;
    showOverlay('contact-info-overlay');
  }

  function handleHeaderClick() {
    if (!activeChat) return;
    if (activeChat.isGroup) { window.Whispr.openGroupInfo?.(activeChat); return; }
    if (activeChat.isSelfChat) { showOverlay('settings-overlay'); return; }
    openContactInfo(activeChat);
  }
  document.getElementById('header-info').addEventListener('click', handleHeaderClick);
  document.getElementById('header-avatar').addEventListener('click', handleHeaderClick);

  // ---------------- reactions ----------------
  let reactionPickerEl = null;
  function getReactionPicker() {
    if (!reactionPickerEl) {
      reactionPickerEl = document.createElement('div');
      reactionPickerEl.className = 'reaction-picker';
      QUICK_REACTIONS.forEach((emoji) => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.addEventListener('click', () => {
          toggleReaction(reactionPickerEl.dataset.msgId, emoji);
          reactionPickerEl.classList.remove('show');
        });
        reactionPickerEl.appendChild(span);
      });
      document.body.appendChild(reactionPickerEl);
    }
    return reactionPickerEl;
  }
  function openReactionPicker(e, msgId) {
    e.stopPropagation();
    const picker = getReactionPicker();
    picker.dataset.msgId = msgId;
    const rect = e.target.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.left = rect.left + 'px';
    picker.style.top = Math.max(rect.top - 44, 4) + 'px';
    picker.classList.add('show');
  }
  document.addEventListener('click', () => { if (reactionPickerEl) reactionPickerEl.classList.remove('show'); });

  function renderReactionBar(bubble, msgId, reactionsCounts) {
    if (!bubble) return;
    let bar = bubble.querySelector('.reaction-bar');
    if (!reactionsCounts || !reactionsCounts.length) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'reaction-bar'; bubble.appendChild(bar); }
    bar.innerHTML = '';
    const mine = myReactions[msgId] || new Set();
    reactionsCounts.forEach((r) => {
      const pill = document.createElement('span');
      pill.className = 'reaction-pill' + (mine.has(r.emoji) ? ' mine' : '');
      pill.textContent = `${r.emoji} ${r.count}`;
      pill.addEventListener('click', () => toggleReaction(msgId, r.emoji));
      bar.appendChild(pill);
    });
  }

  async function toggleReaction(msgId, emoji) {
    const set = myReactions[msgId] || (myReactions[msgId] = new Set());
    const wasMine = set.has(emoji);
    if (wasMine) set.delete(emoji); else set.add(emoji);
    try {
      await api(`/messages/${msgId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
      // UI refresh happens via the 'message:reaction' broadcast (sender included).
    } catch (err) {
      if (wasMine) set.add(emoji); else set.delete(emoji);
      toast(err.message);
    }
  }

  // ---------------- context menu (reply / forward / copy / pin / secure / delete) ----------------
  let contextTarget = null;

  function buildMsgData(msg, row) {
    return {
      id: msg.id || msg._id,
      mine: String(msg.sender._id || msg.sender) === String(me.id),
      isSecure: msg.isSecure,
      deleted: msg.deleted,
      content: msg.content,
      senderName: msg.sender.fullName,
      pinned: row.dataset.pinned === '1',
      chatId: activeChat._id
    };
  }

  function openContextMenu(x, y, msgData) {
    contextTarget = msgData;
    const menu = document.getElementById('context-menu');
    menu.querySelector('[data-action="forward"]').style.display = (!msgData.isSecure && !msgData.deleted) ? 'flex' : 'none';
    menu.querySelector('[data-action="copy"]').style.display = (!msgData.isSecure && !msgData.deleted) ? 'flex' : 'none';
    menu.querySelector('[data-action="secure"]').style.display = (msgData.mine && !msgData.isSecure && !msgData.deleted) ? 'flex' : 'none';
    menu.querySelector('[data-action="delete"]').style.display = (msgData.mine && !msgData.deleted) ? 'flex' : 'none';
    menu.querySelector('[data-action="reply"]').style.display = msgData.deleted ? 'none' : 'flex';

    const menuW = 190, menuH = 260;
    menu.style.left = Math.min(x, window.innerWidth - menuW - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menuH) + 'px';
    menu.classList.add('show');
  }
  document.addEventListener('click', () => { document.getElementById('context-menu').classList.remove('show'); });

  document.querySelectorAll('#context-menu button').forEach((btn) => {
    btn.addEventListener('click', () => handleContextAction(btn.dataset.action));
  });

  function handleContextAction(action) {
    if (!contextTarget) return;
    const t = contextTarget;
    if (action === 'reply') setReplyTarget(t);
    if (action === 'forward') openForwardModal(t);
    if (action === 'copy') { navigator.clipboard?.writeText(t.content || ''); toast('Copied to clipboard.'); }
    if (action === 'pin') togglePin(t.id, t.pinned);
    if (action === 'secure') makeSecure(t);
    if (action === 'delete') deleteMessage(t.id);
  }

  async function deleteMessage(id) {
    try { await api(`/messages/${id}`, { method: 'DELETE' }); } catch (err) { toast(err.message); }
  }

  async function makeSecure(t) {
    if (!t.mine || t.isSecure || t.deleted) return;
    try {
      await api('/messages', { method: 'POST', body: JSON.stringify({ chatId: t.chatId, text: t.content, isSecure: true }) });
      await api(`/messages/${t.id}`, { method: 'DELETE' });
    } catch (err) {
      toast(err.message);
    }
  }

  function openForwardModal(t) {
    pendingForward = t;
    const list = document.getElementById('forward-chat-list');
    list.innerHTML = '';
    chats.forEach((chat) => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.style.width = '40px'; avatar.style.height = '40px';
      paintAvatar(avatar, chatAvatarInfo(chat));
      const meta = document.createElement('div');
      meta.className = 'chat-item-meta';
      meta.innerHTML = `<div class="name">${escapeHtml(chatDisplayName(chat))}</div>`;
      item.appendChild(avatar);
      item.appendChild(meta);
      item.addEventListener('click', async () => {
        try {
          await api('/messages', { method: 'POST', body: JSON.stringify({ chatId: chat._id, text: pendingForward.content }) });
          toast('Forwarded.');
          hideOverlay('forward-overlay');
        } catch (err) { toast(err.message); }
      });
      list.appendChild(item);
    });
    showOverlay('forward-overlay');
  }

  // ---------------- reply bar ----------------
  function setReplyTarget(t) {
    if (t.deleted) return;
    pendingReply = t;
    document.getElementById('reply-bar').classList.add('show');
    document.getElementById('reply-label').textContent = t.mine ? 'Replying to yourself' : `Replying to ${t.senderName || 'them'}`;
    document.getElementById('reply-text').textContent = t.isSecure ? '🔒 Secure Message' : (t.content || '');
    document.getElementById('message-input').focus();
  }
  function clearReply() {
    pendingReply = null;
    document.getElementById('reply-bar').classList.remove('show');
  }
  document.getElementById('cancel-reply-btn').addEventListener('click', clearReply);

  // ---------------- pin / unpin ----------------
  async function togglePin(messageId, currentlyPinned) {
    await api(`/messages/${messageId}/${currentlyPinned ? 'unpin' : 'pin'}`, { method: 'POST' });
    const row = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (row) row.dataset.pinned = currentlyPinned ? '0' : '1';
    loadPinnedBar();
  }

  async function loadPinnedBar() {
    if (!activeChat) return;
    const chatIdAtRequest = activeChat._id;
    const { messages } = await api(`/chats/${chatIdAtRequest}/messages`);
    if (!activeChat || String(activeChat._id) !== String(chatIdAtRequest)) return; // stale response, chat switched
    const pinned = messages.filter((m) => m.pinned && !m.deleted);
    const bar = document.getElementById('pinned-bar');
    bar.innerHTML = '';
    if (!pinned.length) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    pinned.forEach((m) => {
      const chip = document.createElement('div');
      chip.className = 'pinned-chip';
      const text = m.isSecure ? '🔒 Secure Message' : (m.content || '');
      chip.innerHTML = `<span>📌 ${escapeHtml(text.slice(0, 60))}</span>`;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.addEventListener('click', () => togglePin(m.id, true));
      chip.appendChild(btn);
      bar.appendChild(chip);
    });
  }

  // ---------------- render a message ----------------
  function appendMessage(msg, scrollDown) {
    const container = document.getElementById('messages');
    const msgId = msg.id || msg._id;
    const mine = String(msg.sender._id || msg.sender) === String(me.id);

    if (msg.reactions && msg.reactions.length) {
      myReactions[msgId] = new Set(msg.reactions.filter((r) => r.reactedByMe).map((r) => r.emoji));
    }

    const row = document.createElement('div');
    row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');
    row.dataset.msgId = msgId;
    row.dataset.pinned = msg.pinned ? '1' : '0';

    if (activeChat.isGroup && !mine) {
      const senderLabel = document.createElement('div');
      senderLabel.className = 'msg-group-sender';
      senderLabel.textContent = msg.sender.fullName || '';
      container.appendChild(senderLabel);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.deleted) {
      bubble.classList.add('deleted');
      bubble.innerHTML = '<span class="lock-row">🗑 This message was deleted.</span>';
      row.appendChild(bubble);
      container.appendChild(row);
      if (scrollDown) container.scrollTop = container.scrollHeight;
      return;
    }

    if (msg.replyTo) {
      const q = document.createElement('div');
      q.className = 'bubble-quote';
      q.innerHTML = `<span class="q-name">${escapeHtml(msg.replyTo.sender?.fullName || '')}</span><span class="q-text">${escapeHtml(msg.replyTo.preview || '')}</span>`;
      bubble.appendChild(q);
    }

    if (msg.isSecure) {
      renderSecureBubble(bubble, msg);
    } else {
      const textDiv = document.createElement('div');
      textDiv.className = 'text';
      textDiv.textContent = msg.content;
      bubble.appendChild(textDiv);

      // ================= PRO LEVEL BLUE TICKS =================
      const meta = document.createElement('div');
      meta.className = 'meta';
      
      let ticksHTML = '';
      if (mine) {
        const isRead = msg.read || (msg.readBy && msg.readBy.length > 0); 
        ticksHTML = isRead 
          ? '<span class="ticks" style="color: #4da6ff; margin-left: 5px; font-weight: bold; letter-spacing: -2px;">✓✓</span>' 
          : '<span class="ticks" style="color: #999; margin-left: 5px; font-weight: bold;">✓</span>';
      }
      
      meta.innerHTML = `<span class="time">${fmtTime(msg.createdAt)}</span>${ticksHTML}`;
      bubble.appendChild(meta);
      // ========================================================

      const translateBtn = document.createElement('button');
      translateBtn.className = 'translate-btn';
      translateBtn.textContent = `Translate to ${getTargetLang().toUpperCase()}`;
      translateBtn.addEventListener('click', async () => {
        translateBtn.textContent = 'Translating…';
        const translated = await translateText(msg.content);
        if (translated) {
          const t = document.createElement('div');
          t.className = 'translated-text';
          t.textContent = translated;
          bubble.appendChild(t);
          translateBtn.remove();
        } else {
          translateBtn.textContent = 'Translation failed, tap to retry';
        }
      });
      bubble.appendChild(translateBtn);

      renderReactionBar(bubble, msgId, (msg.reactions || []).map((r) => ({ emoji: r.emoji, count: r.count })));
    }

    row.appendChild(bubble);

    const pinBtn = document.createElement('span');
    pinBtn.className = 'pin-affordance';
    pinBtn.title = msg.pinned ? 'Unpin message' : 'Pin message';
    pinBtn.textContent = msg.pinned ? '📌' : '📍';
    pinBtn.style.cursor = 'pointer';
    pinBtn.addEventListener('click', () => togglePin(msgId, !!msg.pinned));
    row.appendChild(pinBtn);

    const reactTrigger = document.createElement('span');
    reactTrigger.className = 'react-trigger';
    reactTrigger.textContent = '🙂+';
    reactTrigger.title = 'React';
    reactTrigger.style.cursor = 'pointer';
    reactTrigger.addEventListener('click', (e) => openReactionPicker(e, msgId));
    row.appendChild(reactTrigger);

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, buildMsgData(msg, row));
    });
    let pressTimer;
    row.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      pressTimer = setTimeout(() => openContextMenu(touch.clientX, touch.clientY, buildMsgData(msg, row)), 500);
    });
    row.addEventListener('touchend', () => clearTimeout(pressTimer));
    row.addEventListener('touchmove', () => clearTimeout(pressTimer));

    container.appendChild(row);
    if (scrollDown) container.scrollTop = container.scrollHeight;
  }

  function renderSecureBubble(bubble, msg) {
    const alreadyDestroyed = msg.selfDestruct?.destroyed;
    bubble.classList.add('secure-locked');

    if (alreadyDestroyed) {
      bubble.innerHTML = `<span class="lock-row">🔥 This message has self-destructed.</span>`;
      bubble.classList.remove('secure-locked');
      return;
    }

    const lockRow = document.createElement('span');
    lockRow.className = 'lock-row';
    lockRow.textContent = `🔒 ${msg.secure.garbledPreview}`;
    bubble.appendChild(lockRow);

    const canUnlock = msg.secure.canUnlock;
    if (!canUnlock) {
      bubble.title = 'Only someone with the right PIN can unlock this Secure Message.';
      return;
    }

    bubble.addEventListener('click', () => {
      window.Whispr.openUnlockModal(msg.id || msg._id, (plaintext, selfDestruct, armDestructTimer) => {
        bubble.classList.remove('secure-locked');
        bubble.classList.add('secure-unlocked');
        bubble.innerHTML = `<span class="lock-row">🔓 ${escapeHtml(plaintext)}</span>`;
        if (armDestructTimer) {
          const duration = selfDestruct.durationSeconds;
          window.Whispr.startDestructTimer(msg.id || msg._id, duration, bubble, () => {
            bubble.innerHTML = `<span class="lock-row">🔥 This message has self-destructed.</span>`;
            bubble.classList.remove('secure-unlocked');
          });
        }
      });
    });
  }

  function renderSmartReplies() {
    const container = document.getElementById('smart-replies');
    container.innerHTML = '';
    const suggestions = getSmartReplies(lastIncomingText);
    suggestions.forEach((s) => {
      const chip = document.createElement('button');
      chip.className = 'smart-reply-chip';
      chip.textContent = s;
      chip.addEventListener('click', () => {
        document.getElementById('message-input').value = s.replace(/^[^\w]+/, '').trim();
        sendMessage();
      });
      container.appendChild(chip);
    });
  }

  // ---------------- composer ----------------
  const secureToggle = document.getElementById('secure-toggle');
  const destructSelect = document.getElementById('destruct-select');
  const sendBtn = document.getElementById('send-btn');
  const messageInput = document.getElementById('message-input');

  secureToggle.addEventListener('change', () => {
    destructSelect.style.display = secureToggle.checked ? 'inline-block' : 'none';
    sendBtn.classList.toggle('secure-armed', secureToggle.checked);
  });

  let typingTimeout = null;
  messageInput.addEventListener('input', () => {
    if (!activeChat) return;
    socket.emit('typing:start', { chatId: activeChat._id });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing:stop', { chatId: activeChat._id }), 1200);

    localStorage.setItem(draftKey(activeChat._id), messageInput.value);

    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  });
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeChat) return;

    const isSecure = secureToggle.checked;
    const selfDestructSeconds = destructSelect.value || null;
    const replyTo = pendingReply ? pendingReply.id : null;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    localStorage.removeItem(draftKey(activeChat._id));
    secureToggle.checked = false;
    destructSelect.style.display = 'none';
    destructSelect.value = '';
    sendBtn.classList.remove('secure-armed');
    clearReply();

    try {
      const { message } = await api('/messages', {
        method: 'POST',
        body: JSON.stringify({ chatId: activeChat._id, text, isSecure, selfDestructSeconds, replyTo })
      });
      // The socket broadcast for this same message can legitimately arrive
      // BEFORE this await resolves (Socket.io is often faster than the
      // fetch Promise settling) - that handler may have already rendered
      // it. renderIfNew() checks the DOM either way, so exactly one copy
      // ever gets appended no matter which path wins the race.
      renderIfNew(message, true);
      let chat = chats.find((c) => String(c._id) === String(activeChat._id));
      
      if (chat) { 
        chat.lastMessageAt = message.createdAt; 
        chat._preview = previewFor(message); 
      } else {
        activeChat.lastMessageAt = message.createdAt;
        activeChat._preview = previewFor(message);
        chats.push(activeChat); 
      }
      
      renderChatList();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------------- new chat / new group ----------------
  document.getElementById('new-chat-btn').addEventListener('click', async () => {
    showOverlay('new-chat-overlay');
    document.getElementById('new-chat-search').value = '';
    await renderUserSearch('');
  });

  document.getElementById('new-chat-search').addEventListener('input', (e) => renderUserSearch(e.target.value));
  document.getElementById('new-chat-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renderUserSearch(document.getElementById('new-chat-search').value);
  });
  document.getElementById('new-chat-search-btn').addEventListener('click', () => {
    renderUserSearch(document.getElementById('new-chat-search').value);
  });

  async function renderUserSearch(query) {
    const q = query.trim().replace(/^@/, '');
    const list = document.getElementById('new-chat-list');
    
    
    list.innerHTML = ''; 

    
    if (q.length === 0) {
      
      list.innerHTML = '<div style="text-align: center; padding: 30px; color: #888; font-size: 14px;">Type a name or @username to search people...</div>';
      return; 
    }

    
    const { users } = await api(`/users/search?q=${encodeURIComponent(q)}`);

    
    if (users.length === 0) {
      list.innerHTML = '<div style="text-align: center; padding: 30px; color: #888; font-size: 14px;">No users found</div>';
      return;
    }

    
    users.forEach((u) => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      paintAvatar(avatar, { name: u.fullName, color: u.avatarColor, image: u.avatarImage });
      
      const meta = document.createElement('div');
      meta.className = 'chat-item-meta';
      meta.innerHTML = `<div class="name">${escapeHtml(u.fullName)}</div><div class="preview">@${escapeHtml(u.username)}</div>`;
      
      item.appendChild(avatar);
      item.appendChild(meta);
      
      item.addEventListener('click', async () => {
        const { chat } = await api('/chats/direct', { method: 'POST', body: JSON.stringify({ userId: u._id }) });
        if (!chats.find((c) => c._id === chat._id)) chats.unshift(chat);
        hideOverlay('new-chat-overlay');
        renderChatList();
        openChat(chat);
      });
      list.appendChild(item);
    });
  }

  document.getElementById('open-group-btn').addEventListener('click', async () => {
    hideOverlay('new-chat-overlay');
    showOverlay('new-group-overlay');
    document.getElementById('group-name-input').value = '';
    const { users } = await api('/users/all');
    const list = document.getElementById('group-member-list');
    list.innerHTML = '';
    users.forEach((u) => {
      const item = document.createElement('label');
      item.className = 'chat-item';
      item.style.cursor = 'pointer';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      paintAvatar(avatar, { name: u.fullName, color: u.avatarColor, image: u.avatarImage });
      const check = document.createElement('input');
      check.type = 'checkbox'; check.value = u._id; check.style.marginRight = '4px';
      const meta = document.createElement('div');
      meta.className = 'chat-item-meta';
      meta.innerHTML = `<div class="name">${escapeHtml(u.fullName)}</div><div class="preview">@${escapeHtml(u.username)}</div>`;
      item.appendChild(check);
      item.appendChild(avatar);
      item.appendChild(meta);
      list.appendChild(item);
    });
  });

  document.getElementById('create-group-btn').addEventListener('click', async () => {
    const groupName = document.getElementById('group-name-input').value.trim();
    const ids = Array.from(document.querySelectorAll('#group-member-list input:checked')).map((i) => i.value);
    if (!groupName || !ids.length) { toast('Add a name and pick at least one member.'); return; }

    const { chat } = await api('/chats/group', { method: 'POST', body: JSON.stringify({ groupName, participantIds: ids }) });
    chats.unshift(chat);
    hideOverlay('new-group-overlay');
    renderChatList();
    openChat(chat);
  });

  // ---------------- translate language picker ----------------
  document.getElementById('translate-lang-btn').addEventListener('click', () => {
    document.getElementById('lang-select').value = getTargetLang();
    showOverlay('lang-overlay');
  });
  document.getElementById('save-lang-btn').addEventListener('click', () => {
    setTargetLang(document.getElementById('lang-select').value);
    hideOverlay('lang-overlay');
    toast('Translation language updated.');
  });

  // ---------------- settings ----------------
  document.getElementById('settings-btn').addEventListener('click', () => showOverlay('settings-overlay'));

  // ---------------- exposed for groupAdmin.js ----------------
  Object.assign(window.Whispr, {
    me,
    getActiveChat: () => activeChat,
    getChats: () => chats,
    getUsersOnline: () => usersOnline,
    toast
  });

  // ---------------- boot ----------------
  connectSocket();
  loadChats();
})();


const suggestionList = [
  "I am good, thanks! 👍",
  "How are you?",
  "Talk to you later.",
  "Sure, no problem.",
  "Got it!",
  "Can we talk right now?",
  "That sounds great!",
  "Okay, perfectly fine.",
  "Yes, exactly.",
  "Call me when you are free."
];


function loadSmartReplies() {
  const container = document.getElementById('smart-replies');
  
  
  if (!container) return; 
  
  container.innerHTML = ''; 
  
  
  const shuffled = [...suggestionList].sort(() => 0.5 - Math.random());
  const selectedReplies = shuffled.slice(0, 3);
  
  
  selectedReplies.forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'reply-pill';
    btn.innerText = text;
    
    
    btn.onclick = () => {
      
      const inputField = document.getElementById('message-input'); 
      if (inputField) {
        inputField.value = text; 
        inputField.focus();      
      }
    };
    
    container.appendChild(btn); 
  });
}


loadSmartReplies();