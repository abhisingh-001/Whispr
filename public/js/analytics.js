(function () {
  const { api } = window.Whispr;

  async function loadAnalytics() {
    const data = await api('/analytics/me');
    document.getElementById('an-sent').textContent = data.messagesSent;
    document.getElementById('an-received').textContent = data.messagesReceived;
    document.getElementById('an-chats').textContent = data.activeChats;
    document.getElementById('an-groups').textContent = data.groups;
    document.getElementById('an-day').textContent = data.mostActiveDay;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('open-analytics-btn')?.addEventListener('click', async () => {
      window.Whispr.showOverlay('analytics-overlay');
      try { await loadAnalytics(); } catch (err) { console.error(err); }
    });
  });
})();
