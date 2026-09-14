(function () {
  const STORAGE_KEY = 'whispr-theme'; // UI preference only - never anything sensitive

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = theme === 'dark' ? '🌙' : '☀️';
    const sidebarBtn = document.getElementById('theme-toggle-btn');
    if (sidebarBtn) sidebarBtn.textContent = icon;
    const settingsBtn = document.getElementById('settings-theme-btn');
    if (settingsBtn) settingsBtn.textContent = icon;
  }

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  applyTheme(getTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleTheme);
    const settingsBtn = document.getElementById('settings-theme-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', toggleTheme);
  });

  window.Whispr = window.Whispr || {};
  window.Whispr.getTheme = getTheme;
})();
