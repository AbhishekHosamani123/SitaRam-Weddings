/* Wedding Dashboard — vanilla JS SPA */
(() => {
  "use strict";

  const SITE_URL = "https://sitaram-weddings.vercel.app";
  const $ = (id) => document.getElementById(id);
  const state = { token: localStorage.getItem("wd_token") || "", couples: [], leads: [], templates: [], selected: null, readonly: false, previewOpen: false };

  // ---------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401 && path !== "/api/login" && path !== "/api/session") {
      logout();
      throw new Error("Session expired — sign in again.");
    }
    return res;
  }
  async function apiJson(path, opts = {}) {
    const res = await api(path, opts);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || data.raw || ("HTTP " + res.status));
    return data;
  }

  function logout() {
    state.token = "";
    localStorage.removeItem("wd_token");
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  }

  // ---------------------------------------------------------------- ui helpers
  const toastTimer = {};
  function toast(msg, isErr = false) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer.t);
    toastTimer.t = setTimeout(() => (t.className = "toast"), 2600);
  }
  function confirmBox(title, text, onOk) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOverlay").classList.remove("hidden");
    $("confirmOk").onclick = () => { $("confirmOverlay").classList.add("hidden"); onOk(); };
    $("confirmCancel").onclick = () => $("confirmOverlay").classList.add("hidden");
  }

  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------------------------------------------------------------- startup
  async function loadTemplates() {
    try {
      const data = await apiJson("/api/templates");
      state.templates = data.templates || [];
    } catch { state.templates = []; }
    // the couples list and editor chip show template names — refresh them
    renderList();
    if (state.selected) {
      const tpl = state.templates.find((t) => t.id === state.selected.template);
      $("templateChip").textContent = tpl ? tpl.name : (state.selected.template || "Ram Mandir");
    }
  }

  async function init() {
    const session = await apiJson("/api/session").catch(() => null);
    if (session && session.ok) {
      $("loginView").classList.add("hidden");
      $("appView").classList.remove("hidden");
      await Promise.all([loadCouples(), loadTemplates(), loadLeads()]);
    } else {
      $("appView").classList.add("hidden");
      $("loginView").classList.remove("hidden");
    }
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").textContent = "";
    try {
      const data = await apiJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("loginPassword").value }),
      });
      state.token = data.token;
      localStorage.setItem("wd_token", data.token);
      $("loginView").classList.add("hidden");
      $("appView").classList.remove("hidden");
      await Promise.all([loadCouples(), loadTemplates(), loadLeads()]);
    } catch (err) {
      $("loginError").textContent = err.message || "Sign-in failed";
    }
  });

  // ---------------------------------------------------------------- couples
  async function loadCouples() {
    const db = await apiJson("/api/couples");
    state.couples = db.couples || [];
    renderList();
    if (state.selected) {
      const found = state.couples.find((c) => c.id === state.selected.id);
      if (found) { state.selected = found; renderEditor(); }
    }
  }

  function renderList() {
    const ul = $("coupleList");
    ul.innerHTML = "";
    for (const c of state.couples) {
      const li = document.createElement("li");
      li.className = c.id === (state.selected && state.selected.id) ? "active" : "";
      li.dataset.id = c.id;
      const tpl = state.templates.find((t) => t.id === (c.template || "ram-mandir"));
      li.innerHTML = `
        <div class="couple-name">${esc(c.bride.firstName || "?")} & ${esc(c.groom.firstName || "?")}</div>
        <div class="couple-sub"><span class="dot ${c.active ? "live" : ""}"></span>${esc(c.slug || "no slug")}${c.demo ? " · demo" : ""}${tpl ? " · " + esc(tpl.name) : ""}${c.source === "public" ? " · self-serve" : ""}</div>`;
      li.onclick = () => selectCouple(c.id);
      ul.appendChild(li);
    }
    renderCustomers();
  }

  // ---------------------------------------------------------------- customers
  function renderCustomers() {
    const tbody = document.querySelector("#custTable tbody");
    if (!tbody) return;
    const list = [...state.couples].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    $("customerCount").textContent = list.length + " total · " + list.filter((c) => c.source === "public").length + " self-serve";
    tbody.innerHTML = "";
    for (const c of list) {
      const tpl = state.templates.find((t) => t.id === (c.template || "ram-mandir"));
      const names = `${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}`;
      const contact = esc(c.contact || "—");
      const created = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—";
      const status = c.demo ? "Demo" : c.paymentStatus === "paid" ? "Paid" : c.source === "public" ? "Unpaid · live" : "Draft";
      const link = c.slug ? `<a href="/${esc(c.slug)}/" target="_blank" rel="noopener">/${esc(c.slug)}/</a>` : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${esc(names)}</strong></td>
        <td>${contact}</td>
        <td>${esc(tpl ? tpl.name : (c.template || "Ram Mandir"))}</td>
        <td>${c.source === "public" ? "Self-serve" : "Admin"}</td>
        <td>${status}</td>
        <td>${created}</td>
        <td>${link}</td>`;
      tbody.appendChild(tr);
    }
  }

  async function loadLeads() {
    try {
      const data = await apiJson("/api/leads");
      state.leads = data.leads || [];
      renderLeads();
    } catch (err) {
      state.leads = [];
      renderLeads();
      toast("Could not load preview leads: " + (err.message || "request failed"), true);
    }
  }

  function renderLeads() {
    const tbody = document.querySelector("#leadTable tbody");
    if (!tbody) return;
    const leads = [...state.leads].sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
    $("leadCount").textContent = leads.length + " total";
    tbody.innerHTML = "";
    for (const lead of leads) {
      const tr = document.createElement("tr");
      const created = lead.created_at ? new Date(lead.created_at).toLocaleString() : "—";
      tr.innerHTML = `
        <td><strong>${esc(lead.couple_names || "—")}</strong></td>
        <td><a href="tel:${esc(lead.phone || "")}">${esc(lead.phone || "—")}</a></td>
        <td>${lead.payment_status === "paid" ? "Paid" : "Unpaid"}</td>
        <td>${esc(created)}</td>
        <td><button class="btn small danger" type="button" data-delete-lead="${esc(lead.id)}">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  document.querySelector("#leadTable tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-lead]");
    if (!button) return;
    const lead = state.leads.find((item) => item.id === button.dataset.deleteLead);
    if (!lead) return;
    confirmBox("Delete preview lead?", `Delete ${lead.couple_names || "this lead"} and its associated preview records?`, async () => {
      try {
        await apiJson("/api/leads/" + encodeURIComponent(lead.id), { method: "DELETE" });
        await loadLeads();
        toast("Preview lead deleted.");
      } catch (err) {
        toast(err.message || "Could not delete the lead.", true);
      }
    });
  });

  function selectCouple(id) {
    state.selected = state.couples.find((c) => c.id === id);
    renderList();
    renderEditor();
  }

  // ---------------------------------------------------------------- editor
  const GALLERY_SLOTS = ["gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"];
  const AFFECTS = {
    invite: "Affects: hero headline · invitation banner · hashtag · hero names",
    couple: "Affects: 'Meet the Bride & Groom' section · parents' names",
    events: "Affects: wedding timeline cards (each row = one card) · Google Maps pin (first event)",
    venue: "Affects: RSVP form · WhatsApp button on the site",
    photos: "Affects: hero banner · couple portraits · photo gallery",
    story: "Affects: story message · weather/staff/parking cards",
    seo: "Affects: browser tab title · share links · URL (slug)",
    customers: "All registrations — contact numbers, templates, status, links",
  };

  function setVal(id, v) {
    const el = $(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v == null ? "" : v;
  }
  function val(id) {
    const el = $(id);
    return el ? (el.type === "checkbox" ? el.checked : el.value) : "";
  }

  function renderEventsRows() {
    const wrap = $("eventsRows");
    wrap.innerHTML = "";
    const events = (state.selected.events || []).slice(0, 6);
    if (!events.length) events.push({ slot: 1, name: "", day: "", time: "", dateLabel: "", venueName: "", venueAddress: "", city: "", lat: "", lng: "", note: "More details below" });
    events.forEach((ev, i) => {
      const row = document.createElement("div");
      row.className = "event-row";
      row.dataset.index = i;
      row.innerHTML = `
        <div class="event-row-head">
          <span class="event-slot">${i + 1}</span>
          <strong>Event ${i + 1}</strong>
          <span class="event-row-actions">
            <button class="mini" data-act="up" title="Move earlier">↑</button>
            <button class="mini" data-act="down" title="Move later">↓</button>
            <button class="mini danger" data-act="remove" title="Remove event">✕</button>
          </span>
        </div>
        <div class="grid2">
          <div class="field"><label>Event name</label><input type="text" class="ev-name" placeholder="Mehendi / Haldi / Shaadi" value="${esc(ev.name)}"></div>
          <div class="field"><label>Day</label><input type="text" class="ev-day" placeholder="Friday" value="${esc(ev.day)}"></div>
          <div class="field"><label>Time</label><input type="text" class="ev-time" placeholder="6 Pm Onwards" value="${esc(ev.time)}"></div>
          <div class="field"><label>Date label</label><input type="text" class="ev-date" placeholder="20th Dec 2026" value="${esc(ev.dateLabel)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Venue name</label><input type="text" class="ev-venue" placeholder="Green Palace Hall" value="${esc(ev.venueName)}"></div>
          <div class="field"><label>City line</label><input type="text" class="ev-city" placeholder="Hubli, Karnataka" value="${esc(ev.city)}"></div>
        </div>
        <div class="field"><label>Address (map card)</label><input type="text" class="ev-address" placeholder="Kusugal Road, Vidyanagar" value="${esc(ev.venueAddress)}"></div>
        <div class="grid2">
          <div class="field"><label>Map latitude</label><input type="text" class="ev-lat" placeholder="15.3647" value="${esc(ev.lat)}"></div>
          <div class="field"><label>Map longitude</label><input type="text" class="ev-lng" placeholder="75.1239" value="${esc(ev.lng)}"></div>
        </div>
        <div class="field"><label>Note on card</label><input type="text" class="ev-note" value="${esc(ev.note || "More details below")}"></div>`;
      wrap.appendChild(row);
    });
  }

  function collectEvents() {
    const rows = [...document.querySelectorAll("#eventsRows .event-row")];
    return rows.map((r, i) => ({
      slot: i + 1,
      name: r.querySelector(".ev-name").value.trim(),
      day: r.querySelector(".ev-day").value.trim(),
      time: r.querySelector(".ev-time").value.trim(),
      dateLabel: r.querySelector(".ev-date").value.trim(),
      venueName: r.querySelector(".ev-venue").value.trim(),
      venueAddress: r.querySelector(".ev-address").value.trim(),
      city: r.querySelector(".ev-city").value.trim(),
      lat: r.querySelector(".ev-lat").value.trim(),
      lng: r.querySelector(".ev-lng").value.trim(),
      note: r.querySelector(".ev-note").value.trim() || "More details below",
    })).filter((e) => e.name);
  }

  function renderEditor() {
    const c = state.selected;
    if (!c) return;
    $("emptyState").classList.add("hidden");
    $("editor").classList.remove("hidden");

    $("editorTitle").textContent = `${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}`;
    $("demoChip").classList.toggle("hidden", !c.demo);
    $("activeChip").classList.toggle("hidden", !c.active);
    const tpl = state.templates.find((t) => t.id === (c.template || "ram-mandir"));
    $("templateChip").textContent = tpl ? tpl.name : (c.template || "Ram Mandir");
    const live = $("liveLink");
    if (c.slug) {
      live.textContent = `/${c.slug}/`;
      live.onclick = () => window.open(`${SITE_URL}/${c.slug}/`, "_blank");
      live.classList.remove("hidden");
    } else live.classList.add("hidden");

    // invitation
    setVal("f_headline", c.invitation.headline);
    setVal("f_intro", c.invitation.intro);
    setVal("f_hashtag", c.invitation.hashtag);
    setVal("f_closing", c.invitation.closing);
    setVal("f_brideFull", c.bride.fullName);
    setVal("f_groomFull", c.groom.fullName);

    // couple
    setVal("f_brideFirst", c.bride.firstName);
    setVal("f_brideParents", c.bride.parents);
    setVal("f_groomFirst", c.groom.firstName);
    setVal("f_groomParents", c.groom.parents);

    // events + countdown + whatsapp
    renderEventsRows();
    setVal("f_countdown", c.countdownTarget ? toLocalInput(c.countdownTarget) : "");
    setVal("f_waDisplay", c.whatsapp.display);
    setVal("f_waIntl", c.whatsapp.intl);

    // story / things to know
    setVal("f_story", c.invitation.story);
    const ttk = {};
    for (const t of c.thingsToKnow || []) ttk[t.key] = t.text;
    setVal("f_ttk_weather", ttk.weather || "");
    setVal("f_ttk_staff", ttk.staff || "");
    setVal("f_ttk_parking", ttk.parking || "");

    // seo
    setVal("f_slug", c.slug);
    setVal("f_active", c.active);
    setVal("f_title", c.title);
    setVal("f_meta", c.metaDescription);

    // images
    for (const slot of ["hero", "bridePhoto", "groomPhoto", "portrait"]) {
      setPreview(slot, c.images[slot]);
    }
    const grid = $("galleryGrid");
    grid.innerHTML = "";
    GALLERY_SLOTS.forEach((slot, i) => {
      const d = document.createElement("div");
      d.className = "field";
      d.innerHTML = `<label>Photo ${i + 1}</label>
        <div class="upload" data-slot="${slot}"><img class="upload-preview" alt=""><input type="file" accept="image/*" class="upload-input"><span class="upload-hint">Click to upload</span></div>`;
      grid.appendChild(d);
      setPreview(slot, (c.gallery || [])[i] || null, d.querySelector(".upload"));
    });

    updatePreview();
    setAffects();
  }

  function setPreview(slot, url, container) {
    const box = container || document.querySelector(`[data-slot="${slot}"]`);
    if (!box) return;
    const img = box.querySelector(".upload-preview");
    if (url) { img.src = url; box.classList.add("has-img"); }
    else { img.removeAttribute("src"); box.classList.remove("has-img"); }
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInput(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return "";
    return d.toISOString();
  }

  // ---------------------------------------------------------------- validation
  function validate(c) {
    const warnings = [];
    if (!c.slug) warnings.push("Missing URL slug (URL & SEO tab).");
    else if (!/^[a-z0-9-]{2,60}$/.test(c.slug)) warnings.push("Slug may only use lowercase letters, numbers and hyphens.");
    if (!c.bride.firstName || !c.groom.firstName) warnings.push("Bride & groom first names are required.");
    if (!c.events.length) warnings.push("Add at least one timeline event with a name.");
    else {
      const main = c.events[0];
      if (!main.dateLabel) warnings.push("First event has no date label — the map card and countdown will look empty.");
      if (!main.venueName) warnings.push("First event has no venue name — the map card will show placeholder text.");
      if (!c.whatsapp.intl) warnings.push("No international WhatsApp number — the RSVP button won't work.");
    }
    return warnings;
  }

  function showValidation(warnings) {
    const box = $("validationBox");
    if (!warnings.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden");
    box.innerHTML = `<strong>Before publishing, fix:</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
  }

  // ---------------------------------------------------------------- save / build / publish
  let busy = false;

  async function save(quiet = false) {
    if (!state.selected) return;
    const c = collect();
    showValidation(validate(c));
    if (!c.slug) { if (!quiet) toast("Give this couple a slug (URL name)", true); return; }
    try {
      const saved = await apiJson(`/api/couples/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c),
      });
      Object.assign(state.selected, saved);
      renderList();
      if (!quiet) toast("Saved — website is live ✔");
      if (state.previewOpen) await refreshPreview();
      return true;
    } catch (e) { toast("Save failed: " + e.message, true); return false; }
  }

  function collect() {
    const c = state.selected;
    c.invitation = {
      headline: val("f_headline") || "{bride} weds {groom}",
      intro: val("f_intro"),
      story: val("f_story"),
      hashtag: val("f_hashtag"),
      closing: val("f_closing"),
    };
    c.bride = {
      firstName: val("f_brideFirst"), fullName: val("f_brideFull") || val("f_brideFirst"),
      parents: val("f_brideParents"), photo: c.bride.photo,
    };
    c.groom = {
      firstName: val("f_groomFirst"), fullName: val("f_groomFull") || val("f_groomFirst"),
      parents: val("f_groomParents"), photo: c.groom.photo,
    };
    c.events = collectEvents();
    c.countdownTarget = fromLocalInput(val("f_countdown"));
    c.whatsapp = { display: val("f_waDisplay"), intl: val("f_waIntl") };
    c.thingsToKnow = [
      { key: "weather", title: "Weather", text: val("f_ttk_weather") },
      { key: "staff", title: "Staff", text: val("f_ttk_staff") },
      { key: "parking", title: "Parking", text: val("f_ttk_parking") },
    ];
    let slug = slugify(val("f_slug"));
    if (!slug && c.bride.firstName && c.groom.firstName) slug = slugify(`${c.bride.firstName}-${c.groom.firstName}`);
    c.slug = slug;
    c.active = !!val("f_active");
    c.title = val("f_title") || `${c.bride.firstName} & ${c.groom.firstName} | Wedding Invitation`;
    c.metaDescription = val("f_meta");
    return c;
  }

  async function refreshPreview() {
    // couple pages are rendered dynamically from Supabase — refreshing the
    // preview is a simple reload (no build step).
    updatePreview();
    return true;
  }

  function updatePreview() {
    const frame = $("previewFrame");
    if (!state.previewOpen || !state.selected) return;
    const slug = state.selected.slug;
    $("previewSlug").textContent = "/" + (slug || "…") + "/";
    if (slug) {
      frame.onload = () => installPreviewBridge();
      frame.src = `/${slug}/?v=${Date.now()}`;
    }
  }

  // ================================================================
  // LIVE PREVIEW BRIDGE — form ↔ preview, same-origin (local only)
  // ================================================================
  const LIVE_FIELD_META = {
    f_brideFirst: { kind: "name", side: "bride" },
    f_groomFirst: { kind: "name", side: "groom" },
    f_hashtag: { kind: "hashtag" },
    f_story: { kind: "story" },
    f_ttk_weather: { kind: "ttk", key: "weather" },
    f_ttk_staff: { kind: "ttk", key: "staff" },
    f_ttk_parking: { kind: "ttk", key: "parking" },
    f_waDisplay: { kind: "phone" },
    f_title: { kind: "title" },
  };

  function previewWin() {
    const frame = $("previewFrame");
    if (!frame || !frame.contentWindow || !frame.contentDocument) return null;
    return { win: frame.contentWindow, doc: frame.contentDocument };
  }
  function prevBride() { return state.selected.bride.firstName || "Sita"; }
  function prevGroom() { return state.selected.groom.firstName || "Ram"; }
  function prevHtag() { return (state.selected.invitation.hashtag || "abkan"); }

  function findByText(doc, txt) {
    if (!txt) return [];
    return [...doc.querySelectorAll("p")].filter((p) => (p.textContent || "").trim() === txt);
  }
  function findContaining(doc, txt) {
    if (!txt) return [];
    return [...doc.querySelectorAll("p")].filter((p) => (p.textContent || "").includes(txt));
  }

  function flashEl(el) {
    if (!el) return;
    el.setAttribute("data-live-flash", "1");
    setTimeout(() => el.removeAttribute("data-live-flash"), 1400);
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { }
  }

  function jumpToField(fieldId) {
    const pv = previewWin();
    if (!pv) { toast("Open the preview first (👁 Preview)", true); return; }
    const { doc } = pv;
    let el = null;
    const c = state.selected;
    switch (fieldId) {
      case "f_brideFirst": el = findByText(doc, prevBride())[0]; break;
      case "f_groomFirst": el = findByText(doc, prevGroom())[0]; break;
      case "f_headline": el = findByText(doc, "weds")[0] || findByText(doc, prevBride())[0]; break;
      case "f_hashtag": el = findContaining(doc, "#" + prevHtag())[0]; break;
      case "f_story": el = findContaining(doc, (c.invitation.story || "hearts").slice(0, 24))[0]; break;
      case "f_ttk_weather": el = findContaining(doc, (c.thingsToKnow.find((t) => t.key === "weather") || {}).text || "sunny")[0]; break;
      case "f_ttk_staff": el = findContaining(doc, (c.thingsToKnow.find((t) => t.key === "staff") || {}).text || "staff")[0]; break;
      case "f_ttk_parking": el = findContaining(doc, (c.thingsToKnow.find((t) => t.key === "parking") || {}).text || "valet")[0]; break;
      case "f_waDisplay": el = findContaining(doc, (c.whatsapp.display || "9819200906"))[0]; break;
      case "f_ev_name": case "f_ev_day": case "f_ev_time": case "f_ev_date":
      case "f_ev_venue": case "f_ev_city": case "f_ev_address":
        el = findByText(doc, getActiveEventField(fieldId))[0]; break;
      default: break;
    }
    if (!el) el = findContaining(doc, "Wedding Timeline")[0] || findContaining(doc, "RSVP")[0];
    flashEl(el);
    if (el) toast("Double-click the field to jump — editing updates preview live");
  }

  function getActiveEventField(fieldId) {
    const ev = (state.selected.events || [])[0] || {};
    switch (fieldId) {
      case "f_ev_name": return ev.name || "Shaadi";
      case "f_ev_day": return ev.day || "Friday";
      case "f_ev_time": return ev.time || "6 Pm Onwards";
      case "f_ev_date": return ev.dateLabel || "29th Aug 2026";
      case "f_ev_venue": return ev.venueName || "Venue Name";
      case "f_ev_city": return ev.city || "Pune, Maharashtra";
      case "f_ev_address": return ev.venueAddress || "Full street address, city, state, ZIP";
      default: return "";
    }
  }

  // live DOM updates inside the iframe
  function liveApplyToPreview(fieldId, value, opts = {}) {
    const pv = previewWin();
    if (!pv) return;
    const { win, doc } = pv;
    const c = state.selected;
    const meta = LIVE_FIELD_META[fieldId];
    try {
      if (meta && meta.kind === "name") {
        const oldVal = meta.side === "bride" ? opts.old || prevBride() : opts.old || prevGroom();
        if (oldVal && value && oldVal !== value) {
          for (const el of findByText(doc, oldVal)) el.textContent = value;
        }
      } else if (meta && meta.kind === "hashtag") {
        const oldH = opts.old || prevHtag();
        for (const el of findContaining(doc, "#" + oldH)) {
          el.textContent = el.textContent.split("#" + oldH).join("#" + value);
        }
      } else if (meta && meta.kind === "story") {
        const anchor = opts.old || (c.invitation.story || "");
        for (const el of findContaining(doc, anchor.slice(0, 24) || "hearts")) el.textContent = value;
      } else if (meta && meta.kind === "ttk") {
        const oldT = opts.old || "";
        if (oldT) for (const el of findContaining(doc, oldT.slice(0, 24))) el.textContent = value;
      } else if (meta && meta.kind === "phone") {
        const oldP = opts.old || "";
        if (oldP) for (const el of findContaining(doc, oldP)) {
          el.textContent = el.textContent.split(oldP).join(value);
        }
      } else if (meta && meta.kind === "title") {
        doc.title = value;
        if (win.__WD_PIN_TITLE__) win.__WD_PIN_TITLE__(value);
      } else if (fieldId.startsWith("ev:")) {
        // events are handled via the wedding-events apply hook
        if (typeof win.__WD_APPLY__ === "function") win.__WD_APPLY__(c.events);
      }
    } catch (e) {
      /* frame may be navigating — ignore */
    }
  }

  // event rows: any change re-applies the full event set
  function eventRowsChanged() {
    const pv = previewWin();
    if (!pv) return;
    try {
      if (typeof pv.win.__WD_APPLY__ === "function") pv.win.__WD_APPLY__(state.selected.events);
    } catch (e) { }
  }

  // install bridge + inline editor into the preview iframe
  function installPreviewBridge() {
    const pv = previewWin();
    if (!pv) return;
    const { win, doc } = pv;
    try {
      if (win.__WD_APPLY__) win.__WD_APPLY__(state.selected.events);
      const pinTitle = (t) => { doc.title = t; const tt = doc.querySelector("title"); if (tt && tt.textContent !== t) tt.textContent = t; };
      win.__WD_PIN_TITLE__ = pinTitle;
      pinTitle(state.selected.title || doc.title);

      // inline editor overlay inside the preview
      const ensureStyles = () => {
        if (doc.getElementById("wd-live-styles")) return;
        const s = doc.createElement("style");
        s.id = "wd-live-styles";
        s.textContent = `
          .wd-live-overlay{position:absolute;z-index:99999;background:#fff;border:2px solid #a04a21;border-radius:8px;padding:2px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:14px system-ui;min-width:160px}
          .wd-live-overlay input{border:none;outline:none;width:100%;padding:6px 8px;font:inherit;background:transparent;color:#3a2318}
          [data-live-flash]{outline:3px solid #a04a21 !important;outline-offset:2px;border-radius:6px;transition:outline-color .2s}`;
        doc.head.appendChild(s);
      };
      ensureStyles();

      doc.addEventListener("dblclick", (e) => {
        const p = e.target.closest ? e.target.closest("p") : null;
        if (!p) return;
        const label = (p.textContent || "").trim();
        let fieldId = null, rowIdx = null, cls = null;
        const c = state.selected;
        if (label === prevBride()) fieldId = "f_brideFirst";
        else if (label === prevGroom()) fieldId = "f_groomFirst";
        else if (label.includes("#" + prevHtag())) fieldId = "f_hashtag";
        else if (label.includes(c.invitation.story?.slice(0, 24) || "hearts")) fieldId = "f_story";
        else if (label.includes(c.whatsapp.display || "9819200906")) fieldId = "f_waDisplay";
        else {
          for (const t of (c.thingsToKnow || [])) {
            if (t.text && label.includes(t.text.slice(0, 24))) { fieldId = "f_ttk_" + t.key; break; }
          }
        }
        if (!fieldId) {
          // map event-card text to its row input
          const evs = c.events || [];
          evs.forEach((ev, i) => {
            if (label === ev.name) { fieldId = "ev"; rowIdx = i; cls = "ev-name"; }
            else if (label === ev.day) { fieldId = "ev"; rowIdx = i; cls = "ev-day"; }
            else if (label === ev.time) { fieldId = "ev"; rowIdx = i; cls = "ev-time"; }
            else if (label === ev.dateLabel) { fieldId = "ev"; rowIdx = i; cls = "ev-date"; }
            else if (label === ev.city) { fieldId = "ev"; rowIdx = i; cls = "ev-city"; }
          });
          if (!fieldId) return;
        }
        // build the overlay input
        const rect = p.getBoundingClientRect();
        const overlay = doc.createElement("div");
        overlay.className = "wd-live-overlay";
        overlay.style.left = Math.min(rect.left, doc.defaultView.innerWidth - 180) + "px";
        overlay.style.top = rect.top + "px";
        const input = doc.createElement("input");
        let cur = "";
        if (fieldId === "ev" && rowIdx != null && cls) {
          cur = (c.events[rowIdx] || {})[EV_KEY_BY_CLASS[cls] || ""] || "";
        } else {
          cur = label;
        }
        input.value = fieldId === "f_hashtag" ? cur.replace("#", "") : cur;
        overlay.appendChild(input);
        doc.body.appendChild(overlay);
        input.focus();
        input.select();
        const commit = () => {
          const next = input.value.trim();
          overlay.remove();
          if (fieldId === "f_hashtag") {
            $("f_hashtag").value = next;
            state.selected.invitation.hashtag = next;
            liveApplyToPreview("f_hashtag", next, { old: prevHtag() });
            toast("Preview updated ✔");
            return;
          }
          if (fieldId.startsWith("f_")) {
            const fieldEl = $(fieldId);
            if (fieldEl) fieldEl.value = next;
            if (fieldId === "f_story") state.selected.invitation.story = next;
            if (fieldId === "f_ttk_weather") state.selected.thingsToKnow.find((t) => t.key === "weather").text = next;
            if (fieldId === "f_ttk_staff") state.selected.thingsToKnow.find((t) => t.key === "staff").text = next;
            if (fieldId === "f_ttk_parking") state.selected.thingsToKnow.find((t) => t.key === "parking").text = next;
            if (fieldId === "f_waDisplay") state.selected.whatsapp.display = next;
            if (fieldId === "f_title") state.selected.title = next;
            liveApplyToPreview(fieldId, next, { old: cur });
            toast("Preview updated ✔");
            return;
          }
          if (fieldId === "ev" && rowIdx != null && cls) {
            const key = EV_KEY_BY_CLASS[cls];
            const ev = state.selected.events[rowIdx];
            if (ev && key) ev[key] = next;
            const inputEl = document.querySelectorAll("#eventsRows .event-row")[rowIdx]?.querySelector("." + cls);
            if (inputEl) inputEl.value = next;
            eventRowsChanged();
            toast("Preview updated ✔");
          }
        };
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); commit(); }
          if (ev.key === "Escape") overlay.remove();
        });
        input.addEventListener("blur", commit);
      });
    } catch (e) {
      /* cross-frame issues ignored */
    }
  }

  // double-click a field in the form → jump to it in the preview
  $("editor").addEventListener("dblclick", (e) => {
    const input = e.target.closest("input,textarea");
    if (!input || !input.id) return;
    if (input.classList.contains("ev-")) {
      const row = input.closest(".event-row");
      if (row) {
        const idx = [...document.querySelectorAll("#eventsRows .event-row")].indexOf(row);
        const label = getActiveEventField("f_ev_name");
        void label;
        jumpToEventSlot(idx, input.classList[0].replace("ev-", ""));
        return;
      }
    }
    jumpToField(input.id);
  });

  const EV_KEY_BY_CLASS = { "ev-name": "name", "ev-day": "day", "ev-time": "time", "ev-date": "dateLabel", "ev-venue": "venueName", "ev-city": "city", "ev-address": "venueAddress", "ev-note": "note", "ev-lat": "lat", "ev-lng": "lng" };

  function jumpToEventSlot(idx, cls) {
    const pv = previewWin();
    if (!pv) return;
    const inputEl = document.querySelectorAll("#eventsRows .event-row")[idx]?.querySelector("." + cls);
    const label = inputEl ? inputEl.value.trim() : "";
    if (!label) return;
    const el = findByText(pv.doc, label)[0] || findContaining(pv.doc, label.slice(0, 24))[0];
    flashEl(el);
  }

  // live typing sync (debounced)
  let liveTimer = null;
  $("editor").addEventListener("input", (e) => {
    const input = e.target;
    if (!input || !input.id) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!state.previewOpen) return;
      if (input.classList.contains("ev-")) {
        eventRowsChanged();
        return;
      }
      const id = input.id;
      const meta = LIVE_FIELD_META[id];
      if (!meta) return;
      const value = input.value;
      if (meta.kind === "name") {
        liveApplyToPreview(id, value, { old: (meta.side === "bride" ? state.selected.bride.firstName : state.selected.groom.firstName) });
        state.selected.bride.firstName = input.id === "f_brideFirst" ? value : state.selected.bride.firstName;
        state.selected.groom.firstName = input.id === "f_groomFirst" ? value : state.selected.groom.firstName;
      } else if (meta.kind === "hashtag") {
        liveApplyToPreview(id, value, { old: state.selected.invitation.hashtag });
        state.selected.invitation.hashtag = value;
      } else if (meta.kind === "story") {
        liveApplyToPreview(id, value, { old: state.selected.invitation.story });
        state.selected.invitation.story = value;
      } else if (meta.kind === "ttk") {
        liveApplyToPreview(id, value, { old: (state.selected.thingsToKnow.find((t) => t.key === meta.key) || {}).text });
        const t = state.selected.thingsToKnow.find((t) => t.key === meta.key);
        if (t) t.text = value;
      } else if (meta.kind === "phone") {
        liveApplyToPreview(id, value, { old: state.selected.whatsapp.display });
        state.selected.whatsapp.display = value;
      } else if (meta.kind === "title") {
        liveApplyToPreview(id, value, {});
        state.selected.title = value;
      }
    }, 250);
  });

  $("saveBtn").onclick = () => save();
  $("buildBtn").onclick = async () => { if (busy) return; busy = true; await refreshPreview(); busy = false; };
  $("publishBtn").onclick = async () => {
    if (busy) return; busy = true;
    try { await save(false); } finally { busy = false; }
  };

  // ---------------------------------------------------------------- preview
  $("previewBtn").onclick = () => {
    state.previewOpen = !state.previewOpen;
    $("previewPane").classList.toggle("hidden", !state.previewOpen);
    $("previewBtn").classList.toggle("active", state.previewOpen);
    updatePreview();
  };
  $("previewRefresh").onclick = () => refreshPreview();

  // ---------------------------------------------------------------- uploads
  document.addEventListener("change", async (e) => {
    const input = e.target;
    if (input.classList.contains("upload-input")) {
      const box = input.closest(".upload");
      const slot = box.dataset.slot;
      if (!slot || !input.files || !input.files[0]) return;
      if (!state.selected || !state.selected.slug) {
        toast("Save the couple first (need a slug) before uploading photos", true);
        return;
      }
      const fd = new FormData();
      fd.append("slug", state.selected.slug);
      fd.append("slot", slot);
      fd.append("file", input.files[0]);
      try {
        const data = await apiJson("/api/upload", { method: "POST", body: fd });
        if (slot.startsWith("gallery")) {
          const idx = Number(slot.slice(7)) - 1;
          state.selected.gallery = state.selected.gallery || [];
          while (state.selected.gallery.length < 6) state.selected.gallery.push(null);
          state.selected.gallery[idx] = data.url;
        } else {
          state.selected.images = state.selected.images || {};
          state.selected.images[slot] = data.url;
        }
        setPreview(slot, data.url, box);
        toast("Photo uploaded ✔");
      } catch (err) { toast("Upload failed: " + err.message, true); }
    }
  });

  // ---------------------------------------------------------------- tabs + events rows
  $("tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab.dataset.tab));
    const affects = $("affectsLine");
    if (affects) affects.textContent = AFFECTS[tab.dataset.tab] || "";
  });

  function setAffects() {
    let active = document.querySelector(".tab.active");
    if (!active) return;
    const affects = $("affectsLine");
    if (affects) affects.textContent = AFFECTS[active.dataset.tab] || "";
  }

  $("addEventBtn").onclick = () => {
    const rows = document.querySelectorAll("#eventsRows .event-row");
    if (rows.length >= 6) { toast("Maximum 6 events", true); return; }
    renderEventsRowsFromData([...collectEvents(), { slot: rows.length + 1, name: "", day: "", time: "", dateLabel: "", venueName: "", venueAddress: "", city: "", lat: "", lng: "", note: "More details below" }]);
  };

  function renderEventsRowsFromData(events) {
    state.selected.events = events;
    renderEventsRows();
  }

  $("eventsRows").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest(".event-row");
    const rows = [...document.querySelectorAll("#eventsRows .event-row")];
    const idx = rows.indexOf(row);
    const act = btn.dataset.act;
    if (act === "remove") {
      rows[idx].remove();
      renderEventsRowsFromData(collectEvents());
      return;
    }
    if (act === "up" && idx > 0) {
      const evs = collectEvents();
      [evs[idx - 1], evs[idx]] = [evs[idx], evs[idx - 1]];
      renderEventsRowsFromData(evs);
    }
    if (act === "down" && idx < rows.length - 1) {
      const evs = collectEvents();
      [evs[idx], evs[idx + 1]] = [evs[idx + 1], evs[idx]];
      renderEventsRowsFromData(evs);
    }
  });

  // ---------------------------------------------------------------- templates
  let tplMode = "create";
  function openTemplateChooser(mode) {
    tplMode = mode;
    $("tplTitle").textContent = mode === "create" ? "Choose a template" : "Change template";
    $("tplSub").textContent = mode === "create"
      ? "Pick the design for this couple's website — you can change it later."
      : "Pick a new design — this couple's details are kept, the page is rebuilt in the new style.";
    const grid = $("tplGrid");
    grid.innerHTML = "";
    const stamp = Date.now();
    for (const t of state.templates) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "tpl-card";
      const c1 = (t.colors && t.colors[0]) || t.accent;
      const c2 = (t.colors && t.colors[1]) || t.accent;
      card.innerHTML = `
        <span class="tpl-preview" style="background:linear-gradient(135deg,${c1},${c2})">
          <iframe src="/templates/${t.id}/?v=${stamp}" loading="lazy" tabindex="-1" title="${esc(t.name)} preview"></iframe>
        </span>
        <span class="tpl-meta">
          <span class="tpl-cat" style="color:${t.accent}">${esc(t.category || "Wedding")}</span>
          <span class="tpl-name">${esc(t.name)}</span>
          <span class="tpl-tag">${esc(t.tagline || "")}</span>
        </span>`;
      card.onclick = () => chooseTemplate(t);
      grid.appendChild(card);
    }
    $("tplOverlay").classList.remove("hidden");
    // scale the desktop-sized demo iframes into the card boxes
    requestAnimationFrame(() => {
      grid.querySelectorAll(".tpl-preview").forEach((pv) => {
        const f = pv.querySelector("iframe");
        if (f && pv.clientWidth) f.style.transform = `scale(${pv.clientWidth / 1280})`;
      });
    });
  }
  function closeTemplateChooser() { $("tplOverlay").classList.add("hidden"); }
  $("tplClose").onclick = closeTemplateChooser;
  $("tplOverlay").addEventListener("click", (e) => { if (e.target === $("tplOverlay")) closeTemplateChooser(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTemplateChooser(); });

  async function chooseTemplate(t) {
    closeTemplateChooser();
    if (tplMode === "create") {
      try {
        const created = await apiJson("/api/couples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: t.id }),
        });
        state.couples.push(created);
        selectCouple(created.id);
        $("editor").scrollIntoView({ behavior: "smooth" });
        toast(`New couple created on "${t.name}" — fill in the details`);
      } catch (e) { toast("Failed to create: " + e.message, true); }
      return;
    }
    const c = state.selected;
    if (!c) return;
    if ((c.template || "ram-mandir") === t.id) { toast(`Already using ${t.name}`); return; }
    confirmBox(`Switch to "${t.name}"?`,
      `${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}'s page will be rebuilt in the new design. All details, photos and events are kept.`,
      async () => {
        try {
          await save(true);
          const saved = await apiJson(`/api/couples/${c.id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: t.id }),
          });
          Object.assign(state.selected, saved);
          renderList();
          renderEditor();
          await refreshPreview();
          toast(`Template changed to ${t.name} ✔`);
        } catch (e) { toast("Template change failed: " + e.message, true); }
      });
  }

  $("templateChip").onclick = () => openTemplateChooser("change");

  // ---------------------------------------------------------------- new / delete
  $("newCoupleBtn").onclick = () => {
    if (!state.templates.length) {
      // registry unavailable — fall back to default creation
      apiJson("/api/couples", { method: "POST" })
        .then((created) => {
          state.couples.push(created);
          selectCouple(created.id);
          $("editor").scrollIntoView({ behavior: "smooth" });
          toast("New couple created — fill in the details");
        })
        .catch((e) => toast("Failed to create: " + e.message, true));
      return;
    }
    openTemplateChooser("create");
  };

  $("deleteBtn").onclick = () => {
    const c = state.selected;
    if (!c) return;
    confirmBox(`Delete ${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}?`,
      `This removes the couple from the Dashboard. Their website link stops working immediately.`,
      async () => {
        try {
          await apiJson(`/api/couples/${c.id}`, { method: "DELETE" });
          state.couples = state.couples.filter((x) => x.id !== c.id);
          state.selected = null;
          $("editor").classList.add("hidden");
          $("emptyState").classList.remove("hidden");
          renderList();
          toast("Couple deleted");
        } catch (e) { toast("Delete failed: " + e.message, true); }
      });
  };

  // keep editor in sync when switching away — save on selection change
  const originalSelect = selectCouple;
  selectCouple = (id) => {
    if (state.selected && state.selected.id !== id) save(true);
    originalSelect(id);
  };

  init().catch((e) => toast("Could not reach the Dashboard API: " + e.message, true));
})();
