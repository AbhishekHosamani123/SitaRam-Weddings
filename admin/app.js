/* Wedding Dashboard — vanilla JS SPA */
(() => {
  "use strict";

  const SITE_URL = "https://sitaram-weddings.vercel.app";
  const $ = (id) => document.getElementById(id);
  const state = { token: localStorage.getItem("wd_token") || "", couples: [], selected: null, readonly: false };

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

  // ---------------------------------------------------------------- startup
  async function init() {
    const session = await api("/api/session").catch(() => null);
    if (session && session.ok) {
      $("loginView").classList.add("hidden");
      $("appView").classList.remove("hidden");
      await loadCouples();
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
      await loadCouples();
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
      li.innerHTML = `
        <div class="couple-name">${esc(c.bride.firstName || "?")} & ${esc(c.groom.firstName || "?")}</div>
        <div class="couple-sub"><span class="dot ${c.active ? "live" : ""}"></span>${esc(c.slug || "no slug")}${c.demo ? " · demo" : ""}</div>`;
      li.onclick = () => selectCouple(c.id);
      ul.appendChild(li);
    }
  }

  function selectCouple(id) {
    state.selected = state.couples.find((c) => c.id === id);
    renderList();
    renderEditor();
  }

  // ---------------------------------------------------------------- editor
  const GALLERY_SLOTS = ["gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

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

  function renderEditor() {
    const c = state.selected;
    if (!c) return;
    $("emptyState").classList.add("hidden");
    $("editor").classList.remove("hidden");

    $("editorTitle").textContent = `${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}`;
    $("demoChip").classList.toggle("hidden", !c.demo);
    $("activeChip").classList.toggle("hidden", !c.active);
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

    // event
    setVal("f_evName", c.event.name);
    setVal("f_evDay", c.event.day);
    setVal("f_evDate", c.event.dateLabel);
    setVal("f_evTime", c.event.time);
    setVal("f_evVenue", c.event.venueName);
    setVal("f_evCity", c.event.city);
    setVal("f_evAddress", c.event.venueAddress);
    setVal("f_evLat", c.event.lat);
    setVal("f_evLng", c.event.lng);
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
    // gallery
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

  // collect from form
  function collect() {
    const c = state.selected;
    const invite = c.invitation || {};
    const ev = c.event || {};
    const wa = c.whatsapp || {};
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
    c.event = {
      name: val("f_evName"), day: val("f_evDay"), dateLabel: val("f_evDate"),
      time: val("f_evTime"), venueName: val("f_evVenue"), city: val("f_evCity"),
      venueAddress: val("f_evAddress"), lat: val("f_evLat"), lng: val("f_evLng"),
    };
    c.countdownTarget = fromLocalInput(val("f_countdown"));
    c.whatsapp = { display: val("f_waDisplay"), intl: val("f_waIntl") };
    c.invitation = { ...invite, ...c.invitation };
    c.event = { ...ev, ...c.event };
    c.whatsapp = { ...wa, ...c.whatsapp };
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

  async function save(quiet = false) {
    if (!state.selected) return;
    const c = collect();
    if (!c.slug) { toast("Give this couple a slug (URL name)", true); return; }
    try {
      const saved = await apiJson(`/api/couples/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c),
      });
      Object.assign(state.selected, saved);
      renderList();
      if (!quiet) toast("Saved ✔");
    } catch (e) { toast("Save failed: " + e.message, true); }
  }

  $("saveBtn").onclick = () => save();

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

  // ---------------------------------------------------------------- tabs
  $("tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab.dataset.tab));
  });

  // ---------------------------------------------------------------- new / delete
  $("newCoupleBtn").onclick = async () => {
    try {
      const created = await apiJson("/api/couples", { method: "POST" });
      state.couples.push(created);
      selectCouple(created.id);
      $("editor").scrollIntoView({ behavior: "smooth" });
      toast("New couple created — fill in the details");
    } catch (e) { toast("Failed to create: " + e.message, true); }
  };

  $("deleteBtn").onclick = () => {
    const c = state.selected;
    if (!c) return;
    confirmBox(`Delete ${c.bride.firstName || "?"} & ${c.groom.firstName || "?"}?`,
      `This removes the couple from the Dashboard. Their generated page stays until the next build.`,
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

  // ---------------------------------------------------------------- build / publish
  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? label : btn.dataset.label || btn.textContent;
    if (!btn.dataset.label) btn.dataset.label = label;
  }
  let busy = false;

  $("buildBtn").onclick = async () => {
    if (busy) return; busy = true;
    const btn = $("buildBtn"); setBusy(btn, true, "Building…");
    $("buildLog").textContent = "Building…";
    try {
      const r = await apiJson("/api/build", { method: "POST" });
      $("buildLog").textContent = (r.output || "").slice(-1200);
      if (r.ok) toast("Build complete ✔"); else toast("Build reported issues — see log", true);
    } catch (e) { $("buildLog").textContent = e.message; toast("Build failed: " + e.message, true); }
    finally { busy = false; setBusy(btn, false); }
  };

  $("publishBtn").onclick = async () => {
    if (busy) return; busy = true;
    await save(true);
    const btn = $("publishBtn"); setBusy(btn, true, "Publishing…");
    $("buildLog").textContent = "Committing & pushing…";
    try {
      const r = await apiJson("/api/publish", { method: "POST" });
      $("buildLog").textContent = (r.steps || []).join("\n").slice(-1200);
      if (r.ok) toast("Published — Vercel deploys in ~1 min 🚀"); else toast("Publish had issues — see log", true);
    } catch (e) { $("buildLog").textContent = e.message; toast("Publish failed: " + e.message, true); }
    finally { busy = false; setBusy(btn, false); }
  };

  // keep editor in sync when switching away — save on selection change
  const originalSelect = selectCouple;
  selectCouple = (id) => {
    if (state.selected && state.selected.id !== id) save(true);
    originalSelect(id);
  };

  init().catch((e) => toast("Could not reach the Dashboard API: " + e.message, true));
})();
