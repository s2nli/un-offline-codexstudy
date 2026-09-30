/* =====================================================================
   NextHope UncOffline — live API-driven learning architecture
   Worker : https://unc-worker.mikey-nt.workers.dev
   GET /api/batches                 -> [{ batch_name, category, subjects:[{subject_name, uid}] }]
   GET /api/collection?id={uid}     -> { results:[{ value:{ title, live_class:{...} } }] }
   GET /api/stream?uid={mediaUid}   -> playable stream
   GET /api/pdf?file={encodedUrl}   -> PDF viewer proxy
   ===================================================================== */
(function () {
  "use strict";

  const BASE = "https://unc-worker.mikey-nt.workers.dev";
  const ARTPLAYER_SRC = "https://cdn.jsdelivr.net/npm/artplayer/dist/artplayer.js";
  const HLS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";

  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------------- Data layer ---------------- */
  function groupFor(category) {
    const c = String(category || "").trim();
    if (/neet/i.test(c)) return "NEET";
    if (/\bjee\b|iit/i.test(c)) return "JEE";
    if (/cuet/i.test(c)) return "CUET";
    const cleaned = c.replace(/\b(19|20)\d{2}\b/g, "").replace(/[-–—_/]+/g, " ").replace(/\s+/g, " ").trim();
    return cleaned || "Other";
  }

  function slug(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function normalizeBatches(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map((raw, index) => {
      const name = raw.batch_name || raw.name || "Untitled batch";
      const category = raw.category || "General";
      let id = String(raw.batch_id || raw._id || raw.id || `unc-${slug(name)}`);
      if (seen.has(id)) id = `${id}-${index}`;
      seen.add(id);
      const subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
        .map((s) => ({ name: s.subject_name || s.name || "Subject", uid: s.uid != null ? String(s.uid) : "" }))
        .filter((s) => s.uid);
      return { _id: id, name, category, group: groupFor(category), byName: category, subjects, subjectCount: subjects.length };
    });
  }

  async function fetchBatches() {
    const response = await fetch(`${BASE}/api/batches`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Batches request failed (${response.status})`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data && (data.batches || data.data || data.results)) || [];
    return normalizeBatches(list);
  }

  function streamUidFrom(url) {
    const match = /[?&]uid=([^&#]+)/.exec(String(url || ""));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function streamUrlFor(videoUrl) {
    const uid = streamUidFrom(videoUrl);
    if (uid) return `${BASE}/api/stream?uid=${encodeURIComponent(uid)}`;
    if (/\.(m3u8|mp4|webm|mkv)(\?|$)/i.test(String(videoUrl || ""))) return String(videoUrl);
    return "";
  }

  function pdfFrom(liveClass) {
    const slides = liveClass && liveClass.slides_pdf;
    if (!slides) return "";
    if (typeof slides === "string") return slides;
    return slides.with_annotation || slides.without_annotation || "";
  }

  function pdfViewerUrl(pdfUrl) {
    return `${BASE}/api/pdf?file=${encodeURIComponent(pdfUrl)}`;
  }

  function mapLecture(item) {
    const value = (item && item.value) || {};
    const live = value.live_class || {};
    const author = live.author || {};
    const teacher = `${author.first_name || ""} ${author.last_name || ""}`.trim();
    const pdf = pdfFrom(live);
    return {
      title: value.title || "Untitled lecture",
      teacher: teacher || "NextHope Faculty",
      avatar: author.avatar || author.avatar_url || author.profile_pic || "",
      liveAt: live.live_at || value.live_at || "",
      videoUrl: live.video_url || "",
      stream: streamUrlFor(live.video_url),
      pdf
    };
  }

  async function fetchCollection(uidField) {
    const ids = String(uidField).split(",").map((s) => s.trim()).filter(Boolean);
    const settled = await Promise.allSettled(ids.map(async (id) => {
      const response = await fetch(`${BASE}/api/collection?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(`Collection ${id} failed (${response.status})`);
      const data = await response.json();
      return Array.isArray(data && data.results) ? data.results : [];
    }));
    const ok = settled.filter((s) => s.status === "fulfilled");
    if (!ok.length) throw new Error("Lectures could not be loaded.");
    const merged = ok.flatMap((s) => s.value).map(mapLecture);
    const seen = new Set();
    const unique = [];
    merged.forEach((lec) => {
      if (!lec.stream && !lec.pdf) return;
      const key = lec.videoUrl || `${lec.title}|${lec.liveAt}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(lec);
    });
    unique.sort((a, b) => (new Date(a.liveAt) || 0) - (new Date(b.liveAt) || 0));
    unique.forEach((lec, i) => { lec.no = i + 1; });
    return unique;
  }

  /* ---------------- Formatting helpers ---------------- */
  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  }

  function dayKey(value) {
    const d = new Date(value);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  }

  function subjectIcon(name) {
    const n = String(name || "").toLowerCase();
    if (/physic/.test(n)) return "⚛️";
    if (/chem/.test(n)) return "🧪";
    if (/botan|plant/.test(n)) return "🌿";
    if (/zoolog|animal/.test(n)) return "🧬";
    if (/biolog/.test(n)) return "🧬";
    if (/math/.test(n)) return "📐";
    if (/english|hindi|language/.test(n)) return "🔤";
    return "📘";
  }

  /* ---------------- Script loader ---------------- */
  const scriptPromises = {};
  function loadScript(src) {
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { delete scriptPromises[src]; reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    });
    return scriptPromises[src];
  }

  /* ---------------- Viewer UI ---------------- */
  const state = { batch: null, view: "closed", subject: null, lectures: [], order: "asc", token: 0 };
  let viewer, playerModal, art = null, nativeVideo = null, hlsInstance = null;

  function buildViewer() {
    if (viewer) return;
    viewer = document.createElement("div");
    viewer.className = "unc-viewer";
    viewer.id = "uncViewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.hidden = true;
    viewer.innerHTML = `
      <div class="unc-topbar">
        <button class="unc-icon-btn" id="uncBack" type="button" aria-label="Go back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="unc-crumbs">
          <div class="unc-crumb-title" id="uncTitle"></div>
          <div class="unc-crumb-sub" id="uncSub"></div>
        </div>
        <button class="unc-icon-btn" id="uncClose" type="button" aria-label="Close viewer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="unc-scroll" id="uncScroll"><div class="unc-inner" id="uncBody"></div></div>`;
    document.body.appendChild(viewer);

    playerModal = document.createElement("div");
    playerModal.className = "unc-player-modal";
    playerModal.id = "uncPlayer";
    playerModal.hidden = true;
    playerModal.setAttribute("role", "dialog");
    playerModal.setAttribute("aria-modal", "true");
    playerModal.innerHTML = `
      <div class="unc-player-card">
        <div class="unc-player-head">
          <div class="unc-player-title" id="uncPlayerTitle"></div>
          <button class="unc-icon-btn" id="uncPlayerClose" type="button" aria-label="Close player"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
        <div class="unc-player-stage" id="uncPlayerStage"></div>
        <div class="unc-player-foot">
          <span><kbd>Space</kbd> play/pause</span><span><kbd>←</kbd><kbd>→</kbd> ±10s</span><span><kbd>↑</kbd><kbd>↓</kbd> volume</span><span><kbd>M</kbd> mute</span><span><kbd>F</kbd> fullscreen</span><span><kbd>Esc</kbd> close</span>
        </div>
      </div>`;
    document.body.appendChild(playerModal);

    $("#uncBack").addEventListener("click", () => { if (history.state && history.state.unc) history.back(); else goBack(); });
    $("#uncClose").addEventListener("click", closeViewer);
    $("#uncPlayerClose").addEventListener("click", closePlayer);
    playerModal.addEventListener("click", (e) => { if (e.target === playerModal) closePlayer(); });
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("popstate", onPopState);
  }

  function setHeader(title, sub) {
    $("#uncTitle").textContent = title;
    $("#uncSub").textContent = sub || "";
  }

  function scrollTop() { const el = $("#uncScroll"); if (el) el.scrollTop = 0; }

  function openBatch(batch) {
    buildViewer();
    state.batch = batch;
    state.subject = null;
    state.lectures = [];
    viewer.hidden = false;
    document.body.classList.add("unc-open");
    try { history.pushState({ unc: "subjects" }, ""); } catch (e) {}
    renderSubjects();
  }

  function renderSubjects() {
    const batch = state.batch;
    state.view = "subjects";
    state.token++;
    setHeader(batch.name, `${batch.category} · ${batch.subjectCount} subject${batch.subjectCount === 1 ? "" : "s"}`);
    const body = $("#uncBody");
    if (!batch.subjects.length) {
      body.innerHTML = '<div class="unc-empty"><div class="unc-empty-ico">📭</div><h3>No subjects yet</h3><p>This batch has no subjects available right now.</p></div>';
      return;
    }
    body.innerHTML = `
      <div class="unc-hero">
        <span class="unc-badge">${esc(batch.category)}</span>
        <h2>${esc(batch.name)}</h2>
        <p>Choose a subject to load its lectures and notes.</p>
      </div>
      <div class="unc-subject-grid">
        ${batch.subjects.map((s, i) => `
          <button class="unc-subject-card" type="button" data-index="${i}">
            <span class="unc-subject-ico">${subjectIcon(s.name)}</span>
            <span class="unc-subject-name">${esc(s.name)}</span>
            <span class="unc-subject-go">Open lectures <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
          </button>`).join("")}
      </div>`;
    $$(".unc-subject-card", body).forEach((card) => card.addEventListener("click", () => {
      openSubject(batch.subjects[Number(card.dataset.index)]);
    }));
    scrollTop();
  }

  function skeletonRows() {
    return Array.from({ length: 6 }, () => '<div class="unc-skel-row"><div class="unc-skel unc-skel-num"></div><div class="unc-skel-col"><div class="unc-skel" style="width:78%"></div><div class="unc-skel" style="width:46%"></div></div></div>').join("");
  }

  async function openSubject(subject) {
    state.subject = subject;
    state.view = "lectures";
    state.order = "asc";
    const token = ++state.token;
    try { history.pushState({ unc: "lectures" }, ""); } catch (e) {}
    setHeader(subject.name, state.batch.name);
    const body = $("#uncBody");
    body.innerHTML = `<div class="unc-skeleton-wrap">${skeletonRows()}</div>`;
    scrollTop();
    try {
      const lectures = await fetchCollection(subject.uid);
      if (token !== state.token) return;
      state.lectures = lectures;
      renderLectures();
    } catch (error) {
      if (token !== state.token) return;
      body.innerHTML = `<div class="unc-empty"><div class="unc-empty-ico">⚠️</div><h3>Couldn't load lectures</h3><p>${esc(error.message || "Please check your connection and try again.")}</p><button class="unc-btn unc-btn-primary" id="uncRetry" type="button">Retry</button></div>`;
      $("#uncRetry").addEventListener("click", () => openSubjectRetry(subject));
    }
  }

  async function openSubjectRetry(subject) {
    // re-run the fetch without pushing another history entry
    const token = ++state.token;
    const body = $("#uncBody");
    body.innerHTML = `<div class="unc-skeleton-wrap">${skeletonRows()}</div>`;
    try {
      const lectures = await fetchCollection(subject.uid);
      if (token !== state.token) return;
      state.lectures = lectures;
      renderLectures();
    } catch (error) {
      if (token !== state.token) return;
      body.innerHTML = `<div class="unc-empty"><div class="unc-empty-ico">⚠️</div><h3>Still unable to load</h3><p>${esc(error.message || "Try again in a moment.")}</p><button class="unc-btn unc-btn-primary" id="uncRetry" type="button">Retry</button></div>`;
      $("#uncRetry").addEventListener("click", () => openSubjectRetry(subject));
    }
  }

  function renderLectures() {
    const lectures = state.lectures;
    const body = $("#uncBody");
    if (!lectures.length) {
      body.innerHTML = '<div class="unc-empty"><div class="unc-empty-ico">🎬</div><h3>No lectures found</h3><p>Nothing has been published for this subject yet.</p></div>';
      return;
    }
    const days = [...new Set(lectures.map((l) => dayKey(l.liveAt)).filter(Boolean))].sort().reverse();
    body.innerHTML = `
      <div class="unc-toolbar">
        <label class="unc-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="uncSearch" type="search" placeholder="Search lectures or educators…" autocomplete="off"></label>
        <select class="unc-select" id="uncDate" aria-label="Filter by date"><option value="all">All dates</option>${days.map((d) => `<option value="${d}">${esc(d.split("-").reverse().join("/"))}</option>`).join("")}</select>
        <button class="unc-btn" id="uncOrder" type="button">Oldest first</button>
      </div>
      <div class="unc-count" id="uncCount"></div>
      <div class="unc-lecture-list" id="uncList"></div>`;
    $("#uncSearch").addEventListener("input", paintLectures);
    $("#uncDate").addEventListener("change", paintLectures);
    $("#uncOrder").addEventListener("click", () => {
      state.order = state.order === "asc" ? "desc" : "asc";
      $("#uncOrder").textContent = state.order === "asc" ? "Oldest first" : "Newest first";
      paintLectures();
    });
    paintLectures();
  }

  function paintLectures() {
    const term = ($("#uncSearch")?.value || "").trim().toLowerCase();
    const day = $("#uncDate")?.value || "all";
    let list = state.lectures.filter((l) => {
      const hay = `${l.title} ${l.teacher}`.toLowerCase();
      if (term && !term.split(/\s+/).every((w) => hay.includes(w))) return false;
      if (day !== "all" && dayKey(l.liveAt) !== day) return false;
      return true;
    });
    if (state.order === "desc") list = [...list].reverse();
    $("#uncCount").textContent = `${list.length} of ${state.lectures.length} lecture${state.lectures.length === 1 ? "" : "s"}`;
    const host = $("#uncList");
    if (!list.length) {
      host.innerHTML = '<div class="unc-empty"><div class="unc-empty-ico">🔍</div><h3>No matches</h3><p>Try a different search or date.</p></div>';
      return;
    }
    host.innerHTML = list.map((l) => `
      <article class="unc-lecture">
        <div class="unc-lec-no">${String(l.no).padStart(2, "0")}</div>
        <div class="unc-lec-main">
          <h3 class="unc-lec-title">${esc(l.title)}</h3>
          <div class="unc-lec-meta">
            <span class="unc-avatar" data-initials="${esc(initials(l.teacher))}">${l.avatar ? `<img src="${esc(l.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(l.teacher))}</span>
            <span class="unc-teacher">${esc(l.teacher)}</span>
            ${l.liveAt ? `<span class="unc-dot">•</span><span class="unc-date">${esc(fmtDate(l.liveAt))}</span>` : ""}
          </div>
          <div class="unc-lec-actions">
            ${l.stream ? `<button class="unc-btn unc-btn-primary" type="button" data-play="${l.no}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play Lecture</button>` : '<button class="unc-btn" type="button" disabled>Video unavailable</button>'}
            ${l.pdf ? `<a class="unc-btn unc-btn-pdf" href="${esc(pdfViewerUrl(l.pdf))}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg> PDF Notes</a>` : ""}
          </div>
        </div>
      </article>`).join("");
    $$(".unc-avatar img", host).forEach((img) => img.addEventListener("error", () => {
      const holder = img.parentElement;
      holder.textContent = holder.dataset.initials || "?";
    }));
    $$("[data-play]", host).forEach((btn) => btn.addEventListener("click", () => {
      const lec = state.lectures.find((l) => l.no === Number(btn.dataset.play));
      if (lec) openPlayer(lec);
    }));
  }

  function goBack() {
    if (state.view === "lectures") { renderSubjects(); return; }
    closeViewer(true);
  }

  function closeViewer(fromHistory) {
    closePlayer();
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    document.body.classList.remove("unc-open");
    state.view = "closed";
    state.token++;
    if (fromHistory !== true && history.state && history.state.unc) {
      // unwind our pushed entries silently
      const steps = history.state.unc === "lectures" ? -2 : -1;
      try { history.go(steps); } catch (e) {}
    }
  }

  function onPopState(event) {
    if (!viewer || viewer.hidden) return;
    const s = event.state && event.state.unc;
    if (playerModal && !playerModal.hidden) closePlayer();
    if (s === "subjects") renderSubjects();
    else if (s === "lectures") { /* forward into lectures: keep what's loaded */ if (state.subject && state.lectures.length) { state.view = "lectures"; setHeader(state.subject.name, state.batch.name); renderLectures(); } else renderSubjects(); }
    else closeViewer(true);
  }

  /* ---------------- Player ---------------- */
  async function openPlayer(lecture) {
    closePlayer(true);
    playerModal.hidden = false;
    $("#uncPlayerTitle").textContent = `${String(lecture.no).padStart(2, "0")} · ${lecture.title}`;
    const stage = $("#uncPlayerStage");
    stage.innerHTML = '<div class="unc-player-loading"><div class="unc-spinner"></div><span>Loading player…</span></div>';
    const isHls = /\.m3u8(\?|$)/i.test(lecture.stream);
    try {
      if (isHls && !window.Hls) await loadScript(HLS_SRC).catch(() => {});
      if (!window.Artplayer) await loadScript(ARTPLAYER_SRC);
      stage.innerHTML = '<div id="uncArtHost" class="unc-art-host"></div>';
      const options = {
        container: "#uncArtHost",
        url: lecture.stream,
        title: lecture.title,
        volume: 0.8,
        autoplay: true,
        pip: true,
        setting: true,
        playbackRate: true,
        aspectRatio: true,
        fullscreen: true,
        fullscreenWeb: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        hotkey: false,
        theme: "#FFC107",
        moreVideoAttr: { crossOrigin: "anonymous" }
      };
      if (isHls && window.Hls && window.Hls.isSupported()) {
        options.type = "m3u8";
        options.customType = {
          m3u8: function (video, url, artInstance) {
            hlsInstance = new window.Hls();
            hlsInstance.loadSource(url);
            hlsInstance.attachMedia(video);
            artInstance.on("destroy", () => { if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; } });
          }
        };
      }
      art = new window.Artplayer(options);
      art.on("error", () => showPlayerError(lecture));
    } catch (error) {
      // Artplayer unavailable: fall back to the plain HTML5 player
      stage.innerHTML = "";
      nativeVideo = document.createElement("video");
      nativeVideo.controls = true;
      nativeVideo.autoplay = true;
      nativeVideo.playsInline = true;
      nativeVideo.className = "unc-native-video";
      nativeVideo.src = lecture.stream;
      nativeVideo.addEventListener("error", () => showPlayerError(lecture));
      stage.appendChild(nativeVideo);
    }
  }

  function showPlayerError(lecture) {
    const note = $("#uncPlayerStage");
    if (!note || $(".unc-player-error", note)) return;
    const div = document.createElement("div");
    div.className = "unc-player-error";
    div.innerHTML = `<strong>This stream could not be played.</strong><span>The worker may be busy or the lecture unavailable.</span><a class="unc-btn" href="${esc(lecture.stream)}" target="_blank" rel="noopener noreferrer">Open stream in new tab</a>`;
    note.appendChild(div);
  }

  function closePlayer(silent) {
    if (art) { try { art.destroy(); } catch (e) {} art = null; }
    if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) {} hlsInstance = null; }
    if (nativeVideo) { try { nativeVideo.pause(); nativeVideo.removeAttribute("src"); nativeVideo.load(); } catch (e) {} nativeVideo = null; }
    const stage = $("#uncPlayerStage");
    if (stage) stage.innerHTML = "";
    if (playerModal && silent !== true) playerModal.hidden = true;
  }

  function currentVideo() {
    if (art && art.video) return art.video;
    return nativeVideo;
  }

  function onKeydown(event) {
    if (!playerModal || playerModal.hidden) {
      if (event.key === "Escape" && viewer && !viewer.hidden) {
        const overlayOpen = document.querySelector(".overlay.visible");
        if (!overlayOpen) { event.preventDefault(); if (history.state && history.state.unc) history.back(); else goBack(); }
      }
      return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const video = currentVideo();
    const key = event.key;
    if (key === "Escape") { event.preventDefault(); closePlayer(); return; }
    if (!video) return;
    const lower = key.toLowerCase();
    if (key === " " || lower === "k") { event.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
    else if (key === "ArrowRight" || lower === "l") { event.preventDefault(); video.currentTime = Math.min((video.duration || Infinity), video.currentTime + 10); }
    else if (key === "ArrowLeft" || lower === "j") { event.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); }
    else if (key === "ArrowUp") { event.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); video.muted = false; }
    else if (key === "ArrowDown") { event.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
    else if (lower === "m") { event.preventDefault(); video.muted = !video.muted; }
    else if (lower === "f") {
      event.preventDefault();
      if (art) art.fullscreen = !art.fullscreen;
      else if (document.fullscreenElement) document.exitFullscreen();
      else video.parentElement.requestFullscreen && video.parentElement.requestFullscreen();
    }
    else if (key === ">" ) { event.preventDefault(); video.playbackRate = Math.min(3, +(video.playbackRate + 0.25).toFixed(2)); }
    else if (key === "<") { event.preventDefault(); video.playbackRate = Math.max(0.25, +(video.playbackRate - 0.25).toFixed(2)); }
  }

  window.UNC = {
    BASE,
    fetchBatches,
    groupFor,
    open: openBatch,
    close: closeViewer,
    isOpen: () => !!viewer && !viewer.hidden
  };
})();
