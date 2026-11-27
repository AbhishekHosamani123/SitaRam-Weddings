(() => {
  const LEGACY = {
    name: ["Shaadi"], day: ["Friday"], time: ["6 Pm Onwards"],
    dateLabel: ["29th Aug 2026"], city: ["Pune, Maharashtra"], note: ["More details below"],
  };
  function assign() {
    const events = self.__WEDDING_EVENTS__ || [];
    const cards = [...document.querySelectorAll('[data-framer-name]')]
      .filter((timeline) => /Wedding Timeline$/.test(timeline.getAttribute('data-framer-name') || ''))
      .flatMap((timeline) => [...timeline.querySelectorAll('div[data-framer-name]')])
      .filter((el) => /^[1-6]$/.test(el.getAttribute('data-framer-name')) && el.querySelector('p'));
    let changed = 0;
    for (const card of cards) {
      const n = +card.getAttribute('data-framer-name');
      const ev = events[n - 1];
      if (!ev) { if (card.style.display !== 'none') { card.style.display = 'none'; changed++; } continue; }
      if (card.style.display === 'none') { card.style.display = ''; changed++; }
      const ps = [...card.querySelectorAll('p')];
      for (const p of ps) {
        const t = (p.textContent || '').trim();
        for (const key of Object.keys(LEGACY)) {
          if (!LEGACY[key].includes(t)) continue;
          const value = ev[key];
          if (typeof value === 'string' && p.textContent !== value) { p.textContent = value; changed++; }
          break;
        }
      }
    }
    const locationFrame = [...document.querySelectorAll('[data-framer-name]')]
      .find((el) => el.getAttribute('data-framer-name') === 'Location Map');
    const map = locationFrame && locationFrame.querySelector(
      '[role="region"][aria-label^="Map showing"], [role="link"][aria-label^="Open "]'
    );
    const mapArea = map && map.parentElement;
    const venue = events[0];
    if (map && mapArea && venue) {
      const locationInfo = mapArea.parentElement && mapArea.parentElement.children[1];
      const venueCard = locationInfo && locationInfo.children[0];
      const locationButtons = locationInfo && locationInfo.children[1];
      const venueName = venue.venueName || venue.name || '';
      const streetAddress = venue.venueAddress || '';
      const cityParts = (venue.city || '').split(',').map((part) => part.trim()).filter(Boolean);
      const venueAddress = [streetAddress, ...cityParts.filter((part) =>
        !streetAddress.toLowerCase().includes(part.toLowerCase())
      )].filter(Boolean).join(', ');
      if (venueName && venueCard && venueCard.children[0]) venueCard.children[0].textContent = venueName;
      if (venueAddress && venueCard && venueCard.children[1]) venueCard.children[1].textContent = venueAddress;
      if (locationButtons && [...locationButtons.querySelectorAll('button')].some((button) => /^Location(?:\s|$)/.test(button.textContent.trim()))) {
        locationButtons.style.display = 'none';
        locationInfo.style.justifyContent = 'center';
        locationInfo.style.flex = '0 1 36%';
      }

      const query = venue.lat && venue.lng
        ? venue.lat + ',' + venue.lng
        : [venueName, venueAddress].filter(Boolean).join(', ');
      const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
      const mapsLink = locationFrame.querySelector('a[href*="google.com/maps"]');
      if (mapsLink) {
        mapsLink.href = mapsUrl;
        mapsLink.setAttribute('aria-label', 'Open ' + (venueName || 'wedding venue') + ' in Google Maps');
      }
      map.setAttribute('role', 'link');
      map.setAttribute('tabindex', '0');
      map.setAttribute('aria-label', 'Open ' + (venueName || 'wedding venue') + ' in Google Maps');
      mapArea.style.cursor = 'pointer';
      mapArea.dataset.googleMapsUrl = mapsUrl;
      if (!mapArea.__weddingMapLinkBound) {
        const openMap = (event) => {
          if (event.target.closest && event.target.closest('a, button')) return;
          window.open(mapArea.dataset.googleMapsUrl, '_blank', 'noopener,noreferrer');
        };
        mapArea.addEventListener('click', openMap);
        map.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.open(mapArea.dataset.googleMapsUrl, '_blank', 'noopener,noreferrer');
          }
        });
        mapArea.__weddingMapLinkBound = true;
      }
    }
    return changed;
  }
  function run() { assign(); }
  const delays = [0, 400, 1200, 2500, 4000, 6000, 8000, 10000];
  delays.forEach((d) => setTimeout(run, d));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('load', run);
  const stop = Date.now() + 12000;
  const observer = new MutationObserver(() => {
    if (Date.now() > stop) { observer.disconnect(); return; }
    run();
  });
  const main = document.getElementById('main') || document.body;
  if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });
  self.__WD_APPLY__ = function (events) {
    if (Array.isArray(events)) self.__WEDDING_EVENTS__ = events;
    return assign();
  };
})();
