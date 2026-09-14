(function () {
  const { api, paintAvatar, escapeHtml, showOverlay, hideOverlay, toast, fileToResizedDataUrl } = window.Whispr;

  let openChatRef = null;

  function isAdmin(chat, userId) {
    return (chat.admins || []).map(String).includes(String(userId));
  }

  function openGroupInfo(chat) {
    openChatRef = chat;
    const me = window.Whispr.me;
    const amAdmin = isAdmin(chat, me.id);

    paintAvatar(document.getElementById('group-pic-preview'), {
      name: chat.groupName, color: chat.groupAvatarColor || '#F2B84B', image: chat.groupAvatarImage
    });
    document.getElementById('group-pic-actions').style.display = amAdmin ? 'flex' : 'none';

    document.getElementById('group-rename-input').value = chat.groupName || '';
    document.getElementById('group-rename-input').disabled = !amAdmin;
    document.getElementById('group-rename-save-btn').style.display = amAdmin ? 'block' : 'none';

    document.getElementById('announcement-row').style.display = amAdmin ? 'flex' : 'none';
    document.getElementById('announcement-toggle').checked = !!chat.announcementOnly;

    renderMembersList(chat, amAdmin);

    document.getElementById('group-add-member-search').value = '';
    document.getElementById('group-add-member-list').innerHTML = '';
    document.getElementById('group-add-member-search').parentElement.style.display = amAdmin ? 'block' : 'none';

    showOverlay('group-info-overlay');
  }

  function renderMembersList(chat, amAdmin) {
    const list = document.getElementById('group-members-admin-list');
    list.innerHTML = '';
    const me = window.Whispr.me;

    chat.participants.forEach((p) => {
      const pid = p._id || p.id;
      const row = document.createElement('div');
      row.className = 'group-member-row';

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.style.width = '34px'; avatar.style.height = '34px'; avatar.style.fontSize = '12px';
      paintAvatar(avatar, { name: p.fullName, color: p.avatarColor, image: p.avatarImage });

      const name = document.createElement('span');
      name.textContent = p.fullName + (String(pid) === String(me.id) ? ' (You)' : '');

      row.appendChild(avatar);
      row.appendChild(name);

      if (isAdmin(chat, pid)) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Admin';
        row.appendChild(badge);
      }

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      row.appendChild(spacer);

      if (amAdmin && String(pid) !== String(me.id)) {
        const promoteBtn = document.createElement('button');
        const alreadyAdmin = isAdmin(chat, pid);
        promoteBtn.textContent = alreadyAdmin ? 'Remove admin' : 'Make admin';
        promoteBtn.addEventListener('click', async () => {
          try {
            const { chat: updated } = await api(
              `/chats/${chat._id}/admins/${pid}`,
              { method: alreadyAdmin ? 'DELETE' : 'POST' }
            );
            openChatRef = updated;
            renderMembersList(updated, amAdmin);
          } catch (err) { toast(err.message); }
        });
        row.appendChild(promoteBtn);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async () => {
          try {
            const { chat: updated } = await api(`/chats/${chat._id}/members/${pid}`, { method: 'DELETE' });
            openChatRef = updated;
            renderMembersList(updated, amAdmin);
          } catch (err) { toast(err.message); }
        });
        row.appendChild(removeBtn);
      }

      list.appendChild(row);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('group-rename-save-btn')?.addEventListener('click', async () => {
      if (!openChatRef) return;
      const groupName = document.getElementById('group-rename-input').value.trim();
      if (!groupName) return;
      try {
        await api(`/chats/${openChatRef._id}`, { method: 'PATCH', body: JSON.stringify({ groupName }) });
        toast('Group renamed.');
      } catch (err) { toast(err.message); }
    });

    document.getElementById('announcement-toggle')?.addEventListener('change', async (e) => {
      if (!openChatRef) return;
      try {
        await api(`/chats/${openChatRef._id}`, { method: 'PATCH', body: JSON.stringify({ announcementOnly: e.target.checked }) });
      } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
    });

    document.getElementById('group-pic-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !openChatRef) return;
      try {
        const dataUrl = await fileToResizedDataUrl(file);
        await api(`/chats/${openChatRef._id}`, { method: 'PATCH', body: JSON.stringify({ groupAvatarImage: dataUrl }) });
      } catch (err) { toast(err.message); }
    });

    document.getElementById('group-add-member-search')?.addEventListener('input', async (e) => {
      const q = e.target.value.trim().replace(/^@/, '');
      const list = document.getElementById('group-add-member-list');
      if (!openChatRef) return;
      const { users } = q ? await api(`/users/search?q=${encodeURIComponent(q)}`) : await api('/users/all');
      const existingIds = new Set(openChatRef.participants.map((p) => String(p._id || p.id)));
      list.innerHTML = '';
      users.filter((u) => !existingIds.has(String(u._id))).forEach((u) => {
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
          try {
            const { chat: updated } = await api(`/chats/${openChatRef._id}/members`, { method: 'POST', body: JSON.stringify({ userId: u._id }) });
            openChatRef = updated;
            renderMembersList(updated, true);
            document.getElementById('group-add-member-search').value = '';
            list.innerHTML = '';
          } catch (err) { toast(err.message); }
        });
        list.appendChild(item);
      });
    });

    window.Whispr.onGroupUpdated = (updatedChat) => {
      if (openChatRef && String(openChatRef._id) === String(updatedChat._id)) {
        openChatRef = updatedChat;
        const amAdmin = isAdmin(updatedChat, window.Whispr.me.id);
        renderMembersList(updatedChat, amAdmin);
      }
    };
  });

  window.Whispr = window.Whispr || {};
  window.Whispr.openGroupInfo = openGroupInfo;
})();
