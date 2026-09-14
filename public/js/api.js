(function () {
  const TOKEN_KEY = 'whispr-token';
  const USER_KEY = 'whispr-user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, { ...options, headers });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }

    if (!res.ok) {
      const err = new Error(data.message || 'Something went wrong.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, { api, getToken, setSession, getUser, clearSession });
})();
