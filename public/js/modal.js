(function () {
  function openOverlays() {
    return Array.from(document.querySelectorAll('.overlay')).filter((o) => !o.classList.contains('hidden'));
  }

  // Esc closes whichever overlay(s) are currently open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = openOverlays();
    if (!open.length) return;
    open.forEach((o) => o.classList.add('hidden'));
  });

  // Clicking the dimmed backdrop (not the modal card itself) also closes it.
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('overlay')) {
      e.target.classList.add('hidden');
    }
  });
})();
