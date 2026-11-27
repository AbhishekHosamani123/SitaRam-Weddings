const assert = require("node:assert/strict");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");
const BUILD = require("../tools/build");

test("legacy timeline slots hide unused cards before hydration", () => {
  const html = [
    '<div class="framer-card" data-framer-name="1" style="will-change:transform"><p>Shaadi</p></div>',
    '<div class="framer-card" data-framer-name="2" style="will-change:transform"><p>Shaadi</p></div>',
  ].join("");

  const rendered = BUILD.applyEventSlots(html, [{ name: "Wedding", dateLabel: "13th Mar 2027" }]);
  assert.match(rendered, /data-framer-name="1" style="will-change:transform[^"]*"><p>Wedding<\/p>/);
  assert.match(rendered, /data-framer-name="2" style="display:none!important;will-change:transform/);
});

test("legacy event script scopes updates to the timeline and uses dateLabel", () => {
  const makeCard = (slot, text) => {
    const paragraph = { textContent: text };
    return {
      style: { display: "" },
      getAttribute: () => String(slot),
      querySelector: () => paragraph,
      querySelectorAll: () => [paragraph],
    };
  };
  const first = makeCard(1, "29th Aug 2026");
  const second = makeCard(2, "Shaadi");
  const unrelated = makeCard(2, "Shaadi");
  const timeline = {
    getAttribute: () => "2 â€” Wedding Timeline",
    querySelectorAll: () => [first, second],
  };
  const document = {
    body: {},
    readyState: "complete",
    querySelectorAll: (selector) => {
      if (selector === "[data-framer-name]") return [timeline, first, second, unrelated];
      if (selector === 'div[data-framer-name]') return [first, second, unrelated];
      return [];
    },
    getElementById: () => null,
    addEventListener: () => {},
  };
  const self = { __WEDDING_EVENTS__: [{ dateLabel: "13th Mar 2027" }] };

  runInNewContext(BUILD.weddingEventsScript(), {
    self,
    document,
    window: { addEventListener: () => {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0,
  });

  assert.equal(first.querySelector("p").textContent, "13th Mar 2027");
  assert.equal(second.style.display, "none");
  assert.equal(unrelated.style.display, "");
});

test("legacy location map opens one event venue in Google Maps without location buttons", () => {
  const listeners = {};
  const mapAttributes = {};
  const venueCard = { children: [{ textContent: "Venue Name" }, { textContent: "Full street address" }] };
  const locationButtons = {
    style: {},
    querySelectorAll: () => [{ textContent: "Location 1" }, { textContent: "Location 2" }],
  };
  const locationInfo = { children: [venueCard, locationButtons], style: {} };
  const mapLayout = { children: [], style: {} };
  const mapArea = {
    dataset: {},
    style: {},
    parentElement: mapLayout,
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  mapLayout.children = [mapArea, locationInfo];
  const map = {
    parentElement: mapArea,
    setAttribute: (name, value) => { mapAttributes[name] = value; },
    addEventListener: (name, callback) => { listeners[`map-${name}`] = callback; },
  };
  const mapsLink = { href: "", setAttribute(name, value) { this[name] = value; } };
  const locationFrame = {
    getAttribute: () => "Location Map",
    querySelector: (selector) => selector.startsWith("[role=") ? map : selector.startsWith("a[") ? mapsLink : null,
  };
  const document = {
    body: {},
    readyState: "complete",
    querySelectorAll: () => [locationFrame],
    getElementById: () => null,
    addEventListener: () => {},
  };
  const opened = [];
  const self = {
    __WEDDING_EVENTS__: [{
      name: "Wedding",
      city: "Kamote",
      venueName: "M10 Geomatrix Silver Crest",
      venueAddress: "Kamote",
      lat: "19.2183",
      lng: "72.9781",
    }],
  };

  runInNewContext(BUILD.weddingEventsScript(), {
    self,
    document,
    window: { addEventListener: () => {}, open: (...args) => opened.push(args) },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0,
    Date,
  });

  assert.equal(locationButtons.style.display, "none");
  assert.equal(locationInfo.style.justifyContent, "center");
  assert.equal(venueCard.children[0].textContent, "M10 Geomatrix Silver Crest");
  assert.equal(venueCard.children[1].textContent, "Kamote");
  assert.equal(mapAttributes.role, "link");
  assert.equal(mapAttributes.tabindex, "0");
  assert.match(mapsLink.href, /query=19\.2183%2C72\.9781/);
  listeners.click({ target: { closest: () => null } });
  assert.equal(opened[0][0], mapsLink.href);
  assert.equal(opened[0][1], "_blank");
  self.__WD_APPLY__([{
    name: "Wedding",
    city: "New City",
    venueName: "Updated Venue",
    venueAddress: "Updated Street",
    lat: "20",
    lng: "73",
  }]);
  assert.equal(venueCard.children[0].textContent, "Updated Venue");
  assert.equal(venueCard.children[1].textContent, "Updated Street, New City");
  assert.match(mapsLink.href, /query=20%2C73/);
});

test("demo dates stay in the future and fall on a Saturday", () => {
  const now = new Date("2026-11-26T10:00:00.000Z");
  const wedding = BUILD.nextDemoWeddingDate(now);
  assert.ok(wedding > now);
  assert.equal(wedding.getUTCDay(), 6);
  assert.equal(wedding.toISOString().slice(11), "12:30:00.000Z");
  assert.equal(BUILD.formatDemoDate(new Date("2027-03-13T12:30:00.000Z")), "13th Mar 2027");
});

test("generated templates lazy-load images without overriding explicit settings", () => {
  const html = '<img src="hero.webp"><img loading="eager" src="logo.webp">';
  assert.equal(
    BUILD.deferImageLoading(html),
    '<img loading="lazy" src="hero.webp"><img loading="eager" src="logo.webp">'
  );
});

test("builder restores the correct create or update action after preview errors", () => {
  const html = BUILD.buildBuilderPage(BUILD.discoverTemplates());
  assert.match(
    html,
    /btn\.textContent = state\.previewToken \? "Update preview link" : "Create preview link";/
  );
});

test("legacy Framer bundles normalize their misencoded punctuation", () => {
  assert.equal(BUILD.normalizeFramerText("Wedding â€” details; We Canâ€™t wait"), "Wedding — details; We Can’t wait");
});
