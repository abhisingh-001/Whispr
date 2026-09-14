(function () {
  const { api } = window.Whispr;

  const activeTimers = {}; // messageId -> intervalId

  function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
  function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

  // ---- PIN status ----
  async function refreshPinStatus() {
    const { enabled } = await api('/secure/status');
    const label = document.getElementById('pin-status-label');
    if (label) label.textContent = enabled ? '🔐 Secure Message PIN: set' : 'Secure Message PIN: not set';
    return enabled;
  }

  // ---- PIN setup modal ----
  function initPinSetupModal() {
    const input = document.getElementById('pin-setup-input');
    const feedback = document.getElementById('pin-setup-feedback');

    document.getElementById('open-pin-setup-btn').addEventListener('click', () => {
      input.value = '';
      feedback.textContent = '';
      showOverlay('pin-setup-overlay');
    });

    document.getElementById('generate-pin-btn').addEventListener('click', async () => {
      const { pin } = await api('/secure/generate-pin', { method: 'POST' });
      input.value = pin;
      feedback.style.color = 'var(--success)';
      feedback.textContent = `Suggested PIN: ${pin} — remember it, then Save.`;
    });

    document.getElementById('save-pin-btn').addEventListener('click', async () => {
      const pin = input.value.trim();
      const accountPassword = document.getElementById('pin-setup-account-password').value;
      if (!/^\d{4,6}$/.test(pin)) {
        feedback.style.color = 'var(--danger)';
        feedback.textContent = 'PIN must be 4-6 digits.';
        return;
      }
      try {
        const result = await api('/secure/setup', {
          method: 'POST',
          body: JSON.stringify({ pin, accountPassword: accountPassword || undefined })
        });
        feedback.style.color = 'var(--success)';
        feedback.textContent = result.vaultSkipped
          ? 'PIN saved! (Vault not enabled - that password didn\'t match your account.)'
          : (result.vaultSaved ? 'PIN saved and added to your Secure PIN Vault!' : 'PIN saved! You can now receive Secure Messages.');
        await refreshPinStatus();
        if (window.Whispr.refreshVaultRow) window.Whispr.refreshVaultRow();
        document.getElementById('pin-setup-account-password').value = '';
        setTimeout(() => hideOverlay('pin-setup-overlay'), 1300);
      } catch (err) {
        feedback.style.color = 'var(--danger)';
        feedback.textContent = err.message;
      }
    });
  }

  // ---- Unlock modal ----
  let pendingUnlock = null; // { messageId, onSuccess }

  function openUnlockModal(messageId, onSuccess) {
    pendingUnlock = { messageId, onSuccess };
    document.getElementById('unlock-pin-input').value = '';
    document.getElementById('unlock-feedback').textContent = '';
    showOverlay('unlock-overlay');
    document.getElementById('unlock-pin-input').focus();
  }

  function initUnlockModal() {
    document.getElementById('unlock-submit-btn').addEventListener('click', submitUnlock);
    document.getElementById('unlock-pin-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitUnlock();
    });
  }

  async function submitUnlock() {
    if (!pendingUnlock) return;
    const pin = document.getElementById('unlock-pin-input').value.trim();
    const feedback = document.getElementById('unlock-feedback');

    if (!/^\d{4,8}$/.test(pin)) {
      feedback.textContent = 'Wrong PIN.';
      return;
    }

    try {
      const data = await api('/secure/unlock', {
        method: 'POST',
        body: JSON.stringify({ messageId: pendingUnlock.messageId, pin })
      });
      hideOverlay('unlock-overlay');
      pendingUnlock.onSuccess(data.plaintext, data.selfDestruct, data.armDestructTimer);
      pendingUnlock = null;
    } catch (err) {
      // Always the same generic message, regardless of what went wrong -
      // no hint is ever given about the real content.
      feedback.textContent = err.message || 'Wrong PIN.';
      document.getElementById('unlock-pin-input').value = '';
    }
  }

  // ---- Self-destruct countdown ----
  // Starts only once a message has been unlocked. Shows a live countdown in
  // the bubble, then asks the server to permanently wipe the message.
  function startDestructTimer(messageId, seconds, bubbleEl, onDestroyed) {
    if (activeTimers[messageId]) return;
    let remaining = seconds;
    const timerEl = document.createElement('span');
    timerEl.className = 'destruct-timer';
    bubbleEl.appendChild(timerEl);

    function tick() {
      timerEl.textContent = `🔥 Self-destructs in ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(activeTimers[messageId]);
        delete activeTimers[messageId];
        api(`/messages/${messageId}/self-destruct`, { method: 'POST' }).catch(() => {});
        if (onDestroyed) onDestroyed();
        return;
      }
      remaining -= 1;
    }
    tick();
    activeTimers[messageId] = setInterval(tick, 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPinSetupModal();
    initUnlockModal();
    refreshPinStatus();

    document.getElementById('open-howto-btn')?.addEventListener('click', () => showOverlay('howto-overlay'));

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => hideOverlay(btn.getAttribute('data-close')));
    });
  });

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, {
    refreshPinStatus,
    openUnlockModal,
    startDestructTimer,
    showOverlay,
    hideOverlay
  });
})();
