(() => {
  const E = (self.__WEDDING_EVENTS__ || []);
  if (!E.length) return;
  const LEGACY = {
    name: ["Shaadi"], day: ["Friday"], time: ["6 Pm Onwards"],
    date: ["29th Aug 2026"], city: ["Pune, Maharashtra"], note: ["More details below"],
  };
  function assign() {
    const cards = [...document.querySelectorAll('div[data-framer-name]')].filter((el) =>
      /^[1-6]$/.test(el.getAttribute('data-framer-name')) && el.querySelector('p'));
    let changed = 0;
    for (const card of cards) {
      const n = +card.getAttribute('data-framer-name');
      const ev = E[n - 1];
      if (!ev) { if (card.style.display !== 'none') { card.style.display = 'none'; changed++; } continue; }
      if (card.style.display === 'none') { card.style.display = ''; changed++; }
      const ps = [...card.querySelectorAll('p')];
      for (const p of ps) {
        const t = (p.textContent || '').trim();
        for (const key of Object.keys(LEGACY)) {
          if (!LEGACY[key].includes(t)) continue;
          if (p.textContent !== ev[key]) { p.textContent = ev[key]; changed++; }
          break;
        }
      }
    }
    return changed;
  }
  function run() { try { assign(); } catch (e) {} }
  const delays = [0, 400, 1200, 2500, 4000, 6000, 8000, 10000];
  delays.forEach((d) => setTimeout(run, d));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('load', run);
  // keep re-applying while Framer keeps reconciling
  const stop = Date.now() + 12000;
  const observer = new MutationObserver(() => {
    if (Date.now() > stop) { observer.disconnect(); return; }
    run();
  });
  const main = document.getElementById('main') || document.body;
  if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });
})();
