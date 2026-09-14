(function () {
  let resolver = null;

  function settle(result) {
    if (resolver) { resolver(result); resolver = null; }
  }

  /**
   * Shows a styled Yes/Cancel dialog and resolves true/false.
   * Usage: const ok = await window.Whispr.confirmAction({ title, message, confirmLabel });
   */
  function confirmAction({ title = 'Are you sure?', message = '', confirmLabel = 'Yes' } = {}) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-yes-btn').textContent = confirmLabel;
    window.Whispr.showOverlay('confirm-overlay');
    return new Promise((resolve) => { resolver = resolve; });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('confirm-yes-btn')?.addEventListener('click', () => {
      window.Whispr.hideOverlay('confirm-overlay');
      settle(true);
    });
    document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => {
      window.Whispr.hideOverlay('confirm-overlay');
      settle(false);
    });
    // Closing any other way (Esc, clicking the dimmed backdrop) counts as "no".
    document.getElementById('confirm-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'confirm-overlay') settle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('confirm-overlay')?.classList.contains('hidden')) {
        settle(false);
      }
    });
  });

  window.Whispr = window.Whispr || {};
  window.Whispr.confirmAction = confirmAction;
})();
