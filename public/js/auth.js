(function () {
  const { api, setSession, getToken } = window.Whispr;

  if (getToken()) {
    window.location.href = '/chat.html';
    return;
  }

  const errorBox = document.getElementById('error-box');
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }
  function clearError() {
    errorBox.style.display = 'none';
  }

  document.getElementById('show-register').addEventListener('click', () => {
    clearError();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
  });
  document.getElementById('show-login').addEventListener('click', () => {
    clearError();
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });

  // 1. PAGE LOAD HOTE HI CHECK KARO KI KYA KOI PURANA USER HAI?
  document.addEventListener('DOMContentLoaded', () => {
    const savedUser = JSON.parse(localStorage.getItem('whispr-last-user'));
    
    if (savedUser) {
      // Username field me chup-chap purana naam daal do aur usko hide kar do
      const identifierInput = document.getElementById('login-identifier');
      identifierInput.value = savedUser.identifier;
      identifierInput.parentElement.style.display = 'none'; // Username wala dabba gayab!

      // Header ko change karke "Continue as User" bana do
      const h1 = document.querySelector('#login-form h1');
      if (h1) h1.innerHTML = `Welcome back, <br><span style="color: #667eea; font-size: 22px;">@${savedUser.identifier}</span>`;

      // Subtitle ko 'Switch Account' ka button bana do
      const sub = document.querySelector('#login-form .sub');
      if (sub) {
        sub.innerHTML = `<a href="#" onclick="localStorage.removeItem('whispr-last-user'); location.reload();" style="color: #aaa; text-decoration: underline; font-size: 13px; cursor: pointer;">Not @${savedUser.identifier}? Switch account</a>`;
      }
    }
  });

  
  document.getElementById('login-btn').addEventListener('click', async () => {
    clearError();
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!identifier || !password) return showError('Please fill in your password.');

    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
      setSession(data.token, data.user);
      
      
      localStorage.setItem('whispr-last-user', JSON.stringify({
        identifier: identifier,
        name: data.user.fullName || data.user.username
      }));

      window.location.href = '/chat.html';
    } catch (err) {
      showError(err.message); // Agar password galat hua toh error dikhega
    }
  });

  // ---- Live "is this username taken?" check, Instagram-style ----
  const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
  const usernameInput = document.getElementById('reg-username');
  const usernameFeedback = document.getElementById('username-feedback');
  let usernameAvailable = null; // null = unknown/untested, true/false once checked
  let usernameCheckTimer = null;

  function setUsernameFeedback(text, kind) {
    usernameFeedback.textContent = text;
    usernameFeedback.className = 'field-feedback' + (kind ? ' ' + kind : '');
    usernameInput.classList.remove('valid', 'invalid');
    if (kind === 'success') usernameInput.classList.add('valid');
    if (kind === 'error') usernameInput.classList.add('invalid');
  }

  usernameInput.addEventListener('input', () => {
    const val = usernameInput.value.trim().toLowerCase();
    clearTimeout(usernameCheckTimer);
    usernameAvailable = null;

    if (!val) { setUsernameFeedback('', null); return; }

    if (!USERNAME_PATTERN.test(val)) {
      setUsernameFeedback('3-20 characters: letters, numbers and underscores only, no spaces.', 'error');
      return;
    }

    setUsernameFeedback('Checking availability…', null);
    usernameCheckTimer = setTimeout(async () => {
      try {
        const { available } = await api(`/auth/check-username?username=${encodeURIComponent(val)}`);
        usernameAvailable = available;
        setUsernameFeedback(
          available ? '✓ Username available' : '✗ Username already taken — try another.',
          available ? 'success' : 'error'
        );
      } catch (err) {
        setUsernameFeedback('', null);
      }
    }, 400);
  });

  document.getElementById('register-btn').addEventListener('click', async () => {
    clearError();
    const fullName = document.getElementById('reg-fullname').value.trim();
    const username = document.getElementById('reg-username').value.trim().toLowerCase();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!fullName || !username || !email || !password) return showError('Please fill in every field.');
    if (!USERNAME_PATTERN.test(username)) {
      return showError('Username must be 3-20 characters: letters, numbers and underscores only, no spaces.');
    }
    if (usernameAvailable === false) {
      return showError('That username is already taken. Please choose another.');
    }

    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, username, email, password })
      });
      setSession(data.token, data.user);
      window.location.href = '/chat.html';
    } catch (err) {
      if (err.data?.field === 'username') setUsernameFeedback(err.message, 'error');
      showError(err.message);
    }
  });

  // Enter-key submit
  document.querySelectorAll('#login-form input').forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('login-btn').click(); })
  );
  document.querySelectorAll('#register-form input').forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('register-btn').click(); })
  );
})();
