(function () {
  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  /**
   * Renders an avatar into `el` (expected to already have the `.avatar`
   * class). Uses the uploaded profile picture when present, otherwise
   * falls back to the existing colored-initials look - used identically
   * in the sidebar footer, chat list, chat header, search results, group
   * member lists, and message rows.
   */
  function paintAvatar(el, { name, color, image }) {
    el.style.background = image ? 'transparent' : (color || '#6C8CFF');
    if (image) {
      el.innerHTML = `<img src="${image}" alt="${(name || '').replace(/"/g, '')}" class="avatar-img" />`;
    } else {
      el.innerHTML = initials(name);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, { initials, paintAvatar, escapeHtml });
})();
