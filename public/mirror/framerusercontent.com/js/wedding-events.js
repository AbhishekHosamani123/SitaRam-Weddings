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
    for (const card of cards) {
      const n = +card.getAttribute('data-framer-name');
      const ev = E[n - 1];
      if (!ev) { card.style.display = 'none'; continue; }
      card.style.display = '';
      const ps = [...card.querySelectorAll('p')];
      for (const p of ps) {
        const t = (p.textContent || '').trim();
        for (const key of Object.keys(LEGACY)) {
          if (!LEGACY[key].includes(t)) continue;
          p.textContent = ev[key];
          break;
        }
      }
    }
  }
  const run = () => { try { assign(); } catch (e) {} };
  if (document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
  setTimeout(run, 1500);
  setTimeout(run, 4000);
})();
