(function () {
  const { api, showOverlay, hideOverlay } = window.Whispr;

  async function refreshVaultRow() {
    try {
      const { vaultEnabled } = await api('/secure/vault/status');
      const btn = document.getElementById('open-vault-btn');
      if (btn) btn.textContent = vaultEnabled ? 'Unlock' : 'Not set up';
    } catch (err) { /* ignore */ }
  }

  function resetVaultModal() {
    document.getElementById('vault-password-input').value = '';
    document.getElementById('vault-feedback').textContent = '';
    document.getElementById('vault-display').style.display = 'none';
    document.getElementById('vault-display').textContent = '';
    document.getElementById('vault-unlock-btn').style.display = 'block';
    document.getElementById('vault-lock-btn').style.display = 'none';
    document.getElementById('vault-password-input').style.display = 'block';
  }

  async function unlockVault() {
    const accountPassword = document.getElementById('vault-password-input').value;
    const feedback = document.getElementById('vault-feedback');
    if (!accountPassword) { feedback.textContent = 'Enter your account password.'; return; }

    try {
      const { pin } = await api('/secure/vault/unlock', {
        method: 'POST',
        body: JSON.stringify({ accountPassword })
      });
      feedback.textContent = '';
      document.getElementById('vault-display').textContent = pin;
      document.getElementById('vault-display').style.display = 'block';
      document.getElementById('vault-unlock-btn').style.display = 'none';
      document.getElementById('vault-password-input').style.display = 'none';
      document.getElementById('vault-lock-btn').style.display = 'block';
    } catch (err) {
      feedback.textContent = err.message || 'Incorrect password.';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshVaultRow();

    document.getElementById('open-vault-btn')?.addEventListener('click', () => {
      resetVaultModal();
      showOverlay('vault-overlay');
    });
    document.getElementById('vault-row')?.addEventListener('click', (e) => {
      if (e.target.id === 'open-vault-btn') return; // avoid double-trigger
      resetVaultModal();
      showOverlay('vault-overlay');
    });
    document.getElementById('vault-unlock-btn')?.addEventListener('click', unlockVault);
    document.getElementById('vault-password-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') unlockVault();
    });
    document.getElementById('vault-lock-btn')?.addEventListener('click', () => {
      resetVaultModal();
    });
  });

  window.Whispr = window.Whispr || {};
  window.Whispr.refreshVaultRow = refreshVaultRow;
})();
