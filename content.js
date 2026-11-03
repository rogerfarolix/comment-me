(() => {
  if (window.__commentMeLoaded) return;
  window.__commentMeLoaded = true;

  const host = location.hostname;
  const PLATFORM = /(^|\.)linkedin\.com$/.test(host)
    ? "linkedin"
    : /(^|\.)facebook\.com$/.test(host)
      ? "facebook"
      : "web";

  // Repères pour trouver une publication / un commentaire. Volontairement larges :
  // si aucun ne correspond, on remonte dans la page jusqu'à trouver assez de texte.
  const SITES = {
    linkedin: {
      post: '[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"], .feed-shared-update-v2, .scaffold-finite-scroll__content > div > div, main article',
      comment: 'article.comments-comment-entity, article[data-id*="comment"], .comments-comment-item, article.comments-comment-item',
      text: [".update-components-text", ".feed-shared-inline-show-more-text", ".feed-shared-text", ".comments-comment-item__main-content", ".comments-comment-entity__content"],
      author: [".update-components-actor__title span[aria-hidden='true']", ".update-components-actor__name", ".comments-comment-meta__description-title", ".comments-comment-meta__actor span[aria-hidden='true']"],
      commentBtn: ["button[aria-label*='omment']"]
    },
    facebook: {
      post: '[aria-posinset], [data-pagelet^="FeedUnit"], [role="dialog"] [role="article"]:not([aria-label]), div[role="article"]:not([aria-label*="omment"])',
      comment: 'div[role="article"][aria-label*="omment"], div[role="article"][aria-label*="éponse"], div[role="article"][aria-label*="eply"]',
      text: ['div[data-ad-preview="message"]', 'div[data-ad-comet-preview="message"]', 'div[dir="auto"]'],
      author: ["h2 strong", "h3 strong", "h4 strong", "h2 a", "h3 a", "strong", "b"],
      commentBtn: ["div[role='button'][aria-label*='omment']"]
    }
  };
  const site = SITES[PLATFORM];

  // Lignes d'interface à retirer du texte lu (boutons, compteurs, dates…).
  const NOISE = /^(j['’]aime|like|réagir|react|commenter|comment|partager|share|répondre|reply|envoyer|send|republier|repost|suivre|follow|\+ suivre|se connecter|connect|voir (plus|moins|la traduction|les \d+ réponses?|plus de commentaires)|see (more|less|translation)|…\s*(plus|more)|modifié|edited|auteur|author|\d+[\s ]*(j|h|min|sem|s|m|d|w|an|ans|mo|y|yr)s?\.?|·|•|\d[\d\s ,.k]*(j['’]aime|réactions?|commentaires?|partages?|comments?|reactions?|reposts?|shares?|likes?)?|\d+e?|1er|2e|3e\+?|plus pertinents|most relevant|tous les commentaires|all comments)$/i;

  let lastEditor = null;
  let hoveredPost = null;
  let settings = { showButtons: true, prefetch: true, learnStyle: true };

  chrome.storage.local.get("cm_settings", ({ cm_settings }) => {
    settings = { ...settings, ...(cm_settings || {}) };
    if (site) startObserver();
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.cm_settings) settings = { ...settings, ...ch.cm_settings.newValue };
  });

  // ---------- Génération (en flux, avec cache pour la préparation à l'avance) ----------

  const jobs = new Map();

  function jobKey(req) {
    return [req.post?.trim(), req.comment, req.intent || "auto", req.extra || ""].join("|");
  }

  function startJob(req, force = false) {
    const key = jobKey(req);
    const cached = jobs.get(key);
    if (cached && !force) return cached;

    const job = { key, suggestions: [], done: false, error: null, listeners: new Set() };
    jobs.set(key, job);
    if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
    const emit = () => job.listeners.forEach((f) => f(job));
    const fail = (msg) => {
      job.error = msg;
      job.done = true;
      jobs.delete(key);
      emit();
    };

    let port;
    try {
      port = chrome.runtime.connect({ name: "cm-stream" });
    } catch {
      fail("L'extension a été mise à jour : recharge la page (F5).");
      return job;
    }
    port.onMessage.addListener((m) => {
      if (m.type === "error") return fail(m.error), port.disconnect();
      job.suggestions = m.suggestions;
      if (m.type === "done") {
        job.done = true;
        port.disconnect();
      }
      emit();
    });
    port.onDisconnect.addListener(() => !job.done && fail("Connexion interrompue. Réessaie."));
    port.postMessage({ platform: PLATFORM, ...req });
    return job;
  }

  function jobDone(job) {
    return new Promise((resolve) => {
      if (job.done) return resolve(job);
      const f = (j) => j.done && (job.listeners.delete(f), resolve(j));
      job.listeners.add(f);
    });
  }

  // Résumé en flux (pas de cache : on ne le demande que sur clic).
  function streamSummary(req, onUpdate) {
    let port;
    try {
      port = chrome.runtime.connect({ name: "cm-stream" });
    } catch {
      onUpdate({ error: "L'extension a été mise à jour : recharge la page (F5).", done: true });
      return () => {};
    }
    let finished = false;
    port.onMessage.addListener((m) => {
      if (m.type !== "delta") finished = true;
      onUpdate({ text: m.text, error: m.error, done: finished });
      if (finished) port.disconnect();
    });
    port.onDisconnect.addListener(() => !finished && onUpdate({ error: "Connexion interrompue. Réessaie.", done: true }));
    port.postMessage({ platform: PLATFORM, ...req, mode: "summary" });
    return () => {
      finished = true;
      try { port.disconnect(); } catch {}
    };
  }

  function reqFrom(ctx, intent = "auto", extra = "") {
    const { post = "", author = "", comment = "", commentAuthor = "", images = [], source } = ctx;
    return { post: post.trim(), author, comment, commentAuthor, images, intent, extra, source };
  }

  // ---------- Apprentissage : on retient les commentaires que tu publies vraiment ----------

  function captureSend(ed) {
    if (!settings.learnStyle) return;
    const text = (ed.value ?? ed.innerText ?? "").trim();
    if (!text) return;
    // Publié = la zone a été vidée (ou retirée) juste après.
    setTimeout(() => {
      const now = document.contains(ed) ? (ed.value ?? ed.innerText ?? "").trim() : "";
      if (!now) {
        try {
          chrome.runtime.sendMessage({ type: "cm-learn", text, platform: PLATFORM });
        } catch {}
      }
    }, 1200);
  }

  if (site) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && isEditor(e.target) && !e.target.closest("#comment-me-root")) captureSend(e.target);
    }, true);
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.('button, [role="button"]');
      if (b && b !== fab && lastEditor && document.contains(lastEditor) && !b.closest("#comment-me-root")) captureSend(lastEditor);
    }, true);
  }

  // Icônes (Lucide, licence ISC).
  const svg = (d, size = 16, fill = false) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">${d}</svg>`;
  const I = {
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    reply: '<path d="M20 20v-7a4 4 0 0 0-4-4H4"/><path d="M9 14 4 9l5-5"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>'
  };

  // ---------- Bouton ✨ dans la zone de commentaire ----------

  const fab = document.createElement("button");
  fab.type = "button";
  fab.innerHTML = svg(I.sparkles, 15, true);
  fab.title = "Comment Me : proposer un commentaire (Alt+Maj+C)";
  fab.setAttribute("aria-label", "Proposer un commentaire");
  Object.assign(fab.style, {
    position: "fixed", zIndex: "2147483646", display: "none",
    width: "28px", height: "28px", borderRadius: "50%", border: "0", padding: "0",
    background: "#4f46e5", color: "#fff", cursor: "pointer",
    display: "none", placeItems: "center", boxShadow: "0 2px 8px rgba(79,70,229,.45)"
  });
  // mousedown + preventDefault : la zone de commentaire garde le focus.
  fab.addEventListener("mousedown", (e) => e.preventDefault());
  fab.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (lastEditor) openPanel({ ...contextFromEditor(lastEditor), target: lastEditor });
  });

  function placeFab() {
    if (!lastEditor || !document.contains(lastEditor)) return (fab.style.display = "none");
    const r = lastEditor.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return (fab.style.display = "none");
    fab.style.left = Math.max(4, r.left - 34) + "px";
    fab.style.top = r.top + Math.min(r.height, 40) / 2 - 14 + "px";
    fab.style.display = "grid";
  }

  function fabReady(ready) {
    fab.style.boxShadow = ready
      ? "0 0 0 3px #22c55e, 0 2px 8px rgba(34,197,94,.5)"
      : "0 2px 8px rgba(79,70,229,.45)";
    fab.title = ready
      ? "Comment Me : propositions prêtes !"
      : "Comment Me : proposer un commentaire (Alt+Maj+C)";
  }

  let prefetchTimer = null;
  function prefetch(ed) {
    clearTimeout(prefetchTimer);
    fabReady(false);
    if (!settings.prefetch) return;
    // Petit délai : on ne dépense pas de quota pour un simple clic de passage.
    prefetchTimer = setTimeout(() => {
      if (document.activeElement !== ed) return;
      const ctx = contextFromEditor(ed);
      if (ctx.post.length < 20) return;
      const job = startJob(reqFrom(ctx));
      const f = (j) => j.done && lastEditor === ed && fabReady(!j.error);
      f(job);
      job.listeners.add(f);
    }, 700);
  }

  if (site) {
    document.addEventListener("focusin", (e) => {
      const t = e.target;
      if (!isEditor(t) || t.closest?.("#comment-me-root")) return;
      lastEditor = t;
      if (!fab.isConnected) document.documentElement.appendChild(fab);
      placeFab();
      prefetch(t);
    }, true);
    document.addEventListener("focusout", () => setTimeout(() => {
      if (!isEditor(document.activeElement)) fab.style.display = "none";
    }, 200), true);
    addEventListener("scroll", placeFab, { passive: true, capture: true });
    addEventListener("resize", placeFab, { passive: true });

    document.addEventListener("mouseover", (e) => {
      const p = e.target.closest?.(site.post);
      if (p) hoveredPost = p;
    }, { passive: true });
  } else {
    document.addEventListener("focusin", (e) => {
      if (isEditor(e.target) && !e.target.closest?.("#comment-me-root")) lastEditor = e.target;
    }, true);
  }

  function isEditor(el) {
    return !!el && (el.isContentEditable || el.tagName === "TEXTAREA");
  }

  // ---------- Lecture du contexte ----------

  // Remonte depuis un élément jusqu'à un bloc contenant assez de texte.
  function climb(el, minChars = 120) {
    let n = el;
    for (let i = 0; n && i < 30; i++, n = n.parentElement) {
      if (n === document.body) break;
      if (cleanText(n, el).length >= minChars) return n;
    }
    return null;
  }

  function cleanText(container, skip) {
    if (!container) return "";
    const seen = new Set();
    let raw = container.innerText || "";
    if (skip && container.contains(skip)) raw = raw.replace(skip.innerText || "", "");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 1 && !NOISE.test(l) && !seen.has(l) && seen.add(l))
      .join("\n")
      .slice(0, 4000);
  }

  function ownText(el, selectors) {
    for (const sel of selectors) {
      const parts = [...el.querySelectorAll(sel)]
        .filter((x) => !x.closest("#comment-me-root"))
        .map((x) => x.innerText.trim())
        .filter(Boolean);
      if (parts.length) return [...new Set(parts)].join("\n");
    }
    return "";
  }

  function authorOf(el) {
    if (!el || !site) return "";
    for (const sel of site.author) {
      const a = el.querySelector(sel);
      const t = a?.innerText?.trim().split("\n")[0];
      if (t && t.length < 80) return t;
    }
    return "";
  }

  // Clique sur « Voir plus » pour lire le texte complet.
  async function expand(el) {
    if (!el) return;
    const btns = [...el.querySelectorAll('button, [role="button"]')].filter((b) =>
      /^(…\s*)?(voir plus|see more|plus|more|afficher la suite)$/i.test(b.innerText.trim())
    );
    btns.slice(0, 3).forEach((b) => b.click());
    if (btns.length) await new Promise((r) => setTimeout(r, 350));
  }

  function readBlock(el, skip) {
    if (!el) return "";
    // Pour le bloc principal, on préfère les zones de texte connues, sinon tout le bloc nettoyé.
    const precise = site ? ownText(el, site.text.slice(0, -1)) : "";
    return (precise.length > 30 ? precise : cleanText(el, skip)).slice(0, 4000);
  }

  // Grandes images de la publication (pas les avatars ni les images des commentaires).
  function imagesOf(el) {
    if (!el) return [];
    return [...el.querySelectorAll("img")]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return i.naturalWidth >= 200 && r.width >= 150 && r.height >= 100 &&
          /^https:/.test(i.currentSrc || i.src) && !(site && i.closest(site.comment));
      })
      .slice(0, 2)
      .map((i) => i.currentSrc || i.src);
  }

  // Contexte à partir de la zone de commentaire où l'utilisateur écrit.
  function contextFromEditor(ed) {
    const ctx = { post: "", author: "", comment: "", commentAuthor: "", el: null };
    if (!site) return ctx;
    const postEl = ed.closest(site.post) || climb(ed, 150);
    const commentEl = ed.closest(site.comment) ||
      // Facebook : la zone de réponse est souvent juste après le commentaire visé.
      prevComment(ed, postEl);
    ctx.el = postEl;
    ctx.post = readBlock(postEl, ed);
    ctx.author = authorOf(postEl);
    ctx.images = imagesOf(postEl);
    if (commentEl && commentEl !== postEl) {
      ctx.commentAuthor = authorOf(commentEl);
      // Sans le nom de l'auteur ni ses initiales d'avatar.
      ctx.comment = cleanText(commentEl, ed).split("\n")
        .filter((l) => l !== ctx.commentAuthor && l.length > 3).join("\n").slice(0, 1500);
    }
    return ctx;
  }

  function prevComment(ed, postEl) {
    if (!site) return null;
    let n = ed;
    for (let i = 0; n && n !== postEl && i < 8; i++, n = n.parentElement) {
      let s = n.previousElementSibling;
      while (s) {
        const c = s.matches(site.comment) ? s : s.querySelector?.(site.comment);
        if (c) return c;
        s = s.previousElementSibling;
      }
    }
    return null;
  }

  function contextFromPost(postEl) {
    return { post: readBlock(postEl), author: authorOf(postEl), images: imagesOf(postEl), comment: "", commentAuthor: "", el: postEl };
  }

  // ---------- Bouton ✨ sur chaque publication ----------

  function startObserver() {
    let pending = false;
    const scan = () => {
      pending = false;
      if (settings.showButtons) document.querySelectorAll(site.post).forEach(addButton);
      toggleNotifButton();
    };
    new MutationObserver(() => {
      if (!pending) {
        pending = true;
        setTimeout(scan, 800);
      }
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  }

  function addButton(post) {
    if (post.dataset.cmDone || post.parentElement?.closest(site.post)) return;
    if (post.getBoundingClientRect().height < 80) return;
    post.dataset.cmDone = "1";
    if (getComputedStyle(post).position === "static") post.style.position = "relative";
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = svg(I.sparkles, 14, true);
    b.title = "Comment Me : proposer un commentaire";
    b.setAttribute("aria-label", "Proposer un commentaire");
    Object.assign(b.style, {
      position: "absolute", top: "8px", right: "88px", zIndex: "5",
      width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #d0d7de",
      background: "#fff", color: "#4f46e5", cursor: "pointer", display: "grid", placeItems: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,.15)", opacity: ".8", padding: "0"
    });
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await expand(post);
      openPanel(contextFromPost(post));
    });
    post.appendChild(b);
  }

  // ---------- Mode notifications : répondre à tous les tags d'un coup ----------

  const TAG_RX = /mentionn|identifi|tagu|parlé de vous|vous a cité|a répondu|a commenté|vous a répondu|mentioned|tagged|replied|commented on|reacted to your comment/i;

  const notifBtn = document.createElement("button");
  notifBtn.type = "button";
  notifBtn.innerHTML = `${svg(I.sparkles, 15, true)}<span>Répondre aux tags</span>`;
  Object.assign(notifBtn.style, {
    position: "fixed", left: "20px", bottom: "20px", zIndex: "2147483646",
    padding: "10px 16px", border: "0", borderRadius: "999px", cursor: "pointer",
    background: "#4f46e5", color: "#fff", display: "flex", alignItems: "center", gap: "8px",
    font: "600 14px system-ui, sans-serif", boxShadow: "0 4px 14px rgba(79,70,229,.45)"
  });
  notifBtn.addEventListener("click", openNotifPanel);

  function toggleNotifButton() {
    const on = /\/notifications/.test(location.pathname);
    if (on && !notifBtn.isConnected) document.documentElement.appendChild(notifBtn);
    if (!on && notifBtn.isConnected) notifBtn.remove();
  }

  function collectNotifs() {
    const scope = document.querySelector('main, [role="main"]') || document.body;
    const items = [];
    const seen = new Set();
    scope.querySelectorAll("a[href]").forEach((a) => {
      const box = a.closest('article, li, [role="row"], [role="listitem"], [role="gridcell"]') || a;
      const text = cleanText(box);
      if (!TAG_RX.test(text) || text.length < 15) return;
      if (seen.has(a.href) || seen.has(text)) return;
      seen.add(a.href);
      seen.add(text);
      items.push({ href: a.href, text: text.slice(0, 800) });
    });
    return items.slice(0, 10);
  }

  async function openNotifPanel() {
    closePanel();
    const items = collectNotifs();
    const root = makeShell(`
      <div class="note" style="text-align:left">${items.length
        ? `${items.length} notification(s) où l'on te sollicite. Les propositions se préparent une par une.`
        : "Aucune mention ou réponse trouvée sur cette page. Fais défiler pour charger plus de notifications, puis réessaie."}</div>
      <div class="list"></div>`);
    const list = root.querySelector(".list");
    list.style.cssText = "display:flex;flex-direction:column;gap:14px";

    const detaches = [];
    panel.cleanup = () => detaches.forEach((d) => d());

    for (const it of items) {
      const box = document.createElement("div");
      box.innerHTML = `<div class="reply" style="max-height:none">${escapeHTML(it.text.slice(0, 220))}</div><div class="out" style="margin-top:6px"></div>`;
      list.appendChild(box);
      it.out = box.querySelector(".out");
    }
    // Une par une, pour respecter les limites des offres gratuites.
    for (const it of items) {
      if (!panel) return;
      const job = startJob({ post: it.text, source: "notification", intent: "auto" });
      detaches.push(renderJob(it.out, job, {
        actions: [
          ["Copier", false, async (t, b) => (await copy(t), flash(b, "Copié ✓"))],
          ["Copier et ouvrir ↗", true, async (t) => (await copy(t), window.open(it.href, "_blank"))]
        ]
      }));
      await jobDone(job);
    }
  }

  // ---------- Insertion ----------

  function findEditor(el) {
    if (!el) return null;
    return el.querySelector('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"], [contenteditable="true"], textarea');
  }

  function waitFor(fn, ms) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const v = fn();
        if (v || Date.now() - start > ms) return resolve(v);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  async function insertComment(text, { target, el }) {
    let ed = target && document.contains(target) ? target : findEditor(el);
    if (!ed && el && site) {
      const btn = el.querySelector(site.commentBtn.join(","));
      if (btn) {
        btn.click();
        ed = await waitFor(() => findEditor(el), 2500);
      }
    }
    if (!ed && lastEditor && document.contains(lastEditor)) ed = lastEditor;
    if (!ed) {
      await copy(text);
      return "copied";
    }

    ed.focus();
    if (ed.tagName === "TEXTAREA") {
      ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, "end");
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      return "inserted";
    }
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    // execCommand reste le plus fiable avec les éditeurs de FB (Lexical) et LinkedIn (Quill).
    if (!document.execCommand("insertText", false, text)) {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
    return "inserted";
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  // ---------- Fenêtre de propositions ----------

  let panel = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .wrap { position: fixed; right: 20px; bottom: 20px; width: 400px; max-height: calc(100vh - 40px);
      display: flex; flex-direction: column; background: #fff; color: #1d2129; border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.25); z-index: 2147483647; font-size: 14px; overflow: hidden; }
    header { display: flex; align-items: center; gap: 8px; padding: 11px 12px 11px 14px; background: #17142a; color: #fff; }
    header b { flex: 1; font-size: 15px; display: flex; align-items: center; gap: 8px; }
    header b svg { color: #a78bfa; }
    header button { background: transparent; border: 0; color: #c9c6d9; cursor: pointer; padding: 6px; border-radius: 8px; }
    header button:hover { color: #fff; }
    header button:hover { background: rgba(255,255,255,.18); }
    .body { padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    details { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 10px; background: #fafafa; }
    summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #57606a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ic { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
    .reply { display: flex; gap: 6px; }
    .reply svg { flex: none; margin-top: 2px; }
    details textarea { margin-top: 6px; }
    .reply { font-size: 12px; color: #3730a3; background: #eef2ff; border-radius: 8px; padding: 6px 10px; max-height: 70px; overflow: hidden; }
    textarea, input { width: 100%; border: 1px solid #d0d7de; border-radius: 8px; padding: 8px; font-size: 13px; color: #1d2129; background: #fff; resize: vertical; }
    textarea:focus, input:focus { outline: 2px solid #c4b5fd; border-color: #7c3aed; }
    .post { min-height: 70px; max-height: 160px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1px solid #d0d7de; background: #fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #1d2129; }
    .chip.on { background: #eef2ff; border-color: #4f46e5; color: #3730a3; font-weight: 600; }
    .go { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .go:disabled { opacity: .7; cursor: wait; }
    .out { display: flex; flex-direction: column; gap: 8px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: #fafafa; }
    .card textarea { background: #fff; min-height: 56px; }
    .row { display: flex; gap: 6px; justify-content: flex-end; }
    .row button { border: 1px solid #d0d7de; background: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; color: #1d2129; }
    .row button.main { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }
    .skel { height: 72px; border-radius: 10px; background: linear-gradient(90deg,#f1f2f6 25%,#e7e8ef 50%,#f1f2f6 75%); background-size: 200% 100%; animation: sh 1.1s infinite; }
    @keyframes sh { to { background-position: -200% 0; } }
    .err { background: #fff1f0; border: 1px solid #ffccc7; color: #a8071a; border-radius: 8px; padding: 8px; font-size: 13px; }
    .err a { color: #a8071a; font-weight: 600; cursor: pointer; text-decoration: underline; }
    .top { display: flex; gap: 6px; align-items: flex-start; }
    .top details { flex: 1; min-width: 0; }
    .sumbtn { display: flex; align-items: center; gap: 6px; border: 1px solid #d0d7de; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; color: #1d2129; white-space: nowrap; }
    .sumbtn:hover { border-color: #4f46e5; color: #3730a3; }
    .sum { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; color: #1d2129; }
    .sum:empty { display: none; }
    .note { font-size: 11px; color: #8b949e; text-align: center; }
  `;

  const INTENTS = [
    ["auto", "Auto"], ["court et direct", "Court"], ["chaleureux", "Chaleureux"],
    ["professionnel", "Pro"], ["avec une pointe d'humour", "Drôle"],
    ["remerciement", "Merci"], ["félicitations", "Bravo"], ["qui pose une question", "Question"]
  ];

  function makeShell(bodyHTML) {
    const hostEl = document.createElement("div");
    hostEl.id = "comment-me-root";
    const root = hostEl.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap" role="dialog" aria-label="Comment Me">
        <header><b>${svg(I.sparkles, 16, true)}Comment Me</b>
          <button class="opt" title="Réglages" aria-label="Réglages">${svg(I.gear)}</button>
          <button class="x" title="Fermer (Échap)" aria-label="Fermer">${svg(I.x)}</button></header>
        <div class="body">${bodyHTML}</div>
      </div>`;
    document.documentElement.appendChild(hostEl);
    root.querySelector(".x").addEventListener("click", closePanel);
    root.querySelector(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
      e.stopPropagation(); // évite les raccourcis du site pendant la saisie
    });
    const onKey = (e) => e.key === "Escape" && closePanel();
    document.addEventListener("keydown", onKey);
    panel = { hostEl, onKey, cleanup: null };
    return root;
  }

  function openPanel(ctx) {
    closePanel();
    const { post = "", author = "", comment = "", commentAuthor = "" } = ctx;
    const firstLine = post.split("\n").find((l) => l.length > 15 && l !== author) || post.split("\n")[0] || "";
    const summary = post ? `${author ? author + " : " : ""}${firstLine.slice(0, 70)}` : "";
    const root = makeShell(`
          ${comment ? `<div class="reply">${svg(I.reply, 14)}<span>Réponse à ${escapeHTML(commentAuthor || "un commentaire")} : ${escapeHTML(comment.slice(0, 200))}</span></div>` : ""}
          <div class="top">
            <details ${post ? "" : "open"}>
              <summary>${post ? escapeHTML(summary) : "Texte de la publication"}</summary>
              <textarea class="post" placeholder="Sélectionne ou colle le texte de la publication…"></textarea>
            </details>
            <button class="sumbtn" title="Résumer la publication">${svg(I.doc, 14)}Résumer</button>
          </div>
          <div class="sum"></div>
          <div class="chips">${INTENTS.map(([v, l], i) => `<button class="chip${i ? "" : " on"}" data-v="${escapeHTML(v)}">${l}</button>`).join("")}</div>
          <input class="extra" placeholder="Consigne en plus (optionnel), puis Entrée">
          <button class="go">Proposer des commentaires</button>
          <div class="out"></div>
          <div class="note">Rien n'est publié automatiquement : c'est toi qui publies.</div>`);

    const $ = (s) => root.querySelector(s);
    $(".post").value = post;
    let intent = "auto";

    root.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        root.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        intent = c.dataset.v;
        if ($(".post").value.trim()) run();
      })
    );
    $(".extra").addEventListener("keydown", (e) => e.key === "Enter" && run());
    let stopSummary = null;
    $(".sumbtn").addEventListener("click", () => {
      const text = $(".post").value.trim();
      if (!text) return void ($("details").open = true);
      stopSummary?.();
      const box = $(".sum");
      box.textContent = "Résumé en cours…";
      stopSummary = streamSummary({ ...reqFrom(ctx), post: text }, ({ text: t, error }) => {
        if (error) box.textContent = error;
        else if (t) box.textContent = t;
      });
    });
    $(".go").addEventListener("click", () => run(generated));
    let generated = false;
    let detach = null;

    function run(force = false) {
      const go = $(".go");
      const out = $(".out");
      const text = $(".post").value.trim();
      if (!text) {
        out.innerHTML = `<div class="err">Aucun texte trouvé. Sélectionne-le ou colle-le dans « Texte de la publication ».</div>`;
        $("details").open = true;
        return;
      }
      detach?.();
      generated = true;
      go.disabled = true;
      go.textContent = "Rédaction…";
      const job = startJob({ ...reqFrom(ctx, intent, $(".extra").value.trim()), post: text }, force);
      detach = renderJob(out, job, {
        actions: [
          ["Copier", false, async (t, b) => (await copy(t), flash(b, "Copié ✓"))],
          ["Insérer", true, async (t, b) => {
            const r = await insertComment(t, ctx);
            if (r === "copied") flash(b, "Copié : colle avec Ctrl+V", 2500);
            else closePanel();
          }]
        ],
        onDone: (j) => {
          go.disabled = false;
          go.textContent = j.error ? "Réessayer" : "Régénérer";
        }
      });
    }

    panel.cleanup = () => (detach?.(), stopSummary?.());

    if (post) run();
    else $(".post").focus();
  }

  // Affiche les propositions d'une génération, au fur et à mesure qu'elles arrivent.
  function renderJob(out, job, { actions, onDone }) {
    const cards = [];
    const render = (j) => {
      if (j.error) {
        out.innerHTML = `<div class="err">${escapeHTML(j.error)}<br><a class="o2">Ouvrir les réglages</a></div>`;
        out.querySelector(".o2").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
        onDone?.(j);
        return;
      }
      out.querySelector(".skel")?.remove();
      j.suggestions.forEach((text, i) => {
        if (!cards[i]) {
          const card = document.createElement("div");
          card.className = "card";
          card.innerHTML = `<textarea rows="3"></textarea><div class="row"></div>`;
          const ta = card.querySelector("textarea");
          actions.forEach(([label, main, fn]) => {
            const b = document.createElement("button");
            b.textContent = label;
            if (main) b.className = "main";
            b.addEventListener("click", () => fn(ta.value, b));
            card.querySelector(".row").appendChild(b);
          });
          out.appendChild(card);
          cards[i] = ta;
        }
        // On n'écrase pas une proposition que l'utilisateur est en train de modifier.
        if (cards[i].dataset.edited !== "1") cards[i].value = text;
        cards[i].oninput = () => (cards[i].dataset.edited = "1");
      });
      if (!j.done) out.insertAdjacentHTML("beforeend", `<div class="skel"></div>`);
      else onDone?.(j);
    };
    out.innerHTML = `<div class="skel"></div>`;
    render(job);
    job.listeners.add(render);
    return () => job.listeners.delete(render);
  }

  function closePanel() {
    if (!panel) return;
    document.removeEventListener("keydown", panel.onKey);
    panel.cleanup?.();
    panel.hostEl.remove();
    panel = null;
  }

  function flash(btn, txt, ms = 1200) {
    const old = btn.textContent;
    btn.textContent = txt;
    setTimeout(() => (btn.textContent = old), ms);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------- Messages du service worker ----------

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "cm-ping") {
      sendResponse(true);
      return;
    }
    if (msg.type !== "cm-open") return;

    const selection = (msg.text || getSelection().toString()).trim();
    const anchor = getSelection().anchorNode;
    const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    const active = document.activeElement;

    (async () => {
      let ctx;
      if (isEditor(active) && !active.closest("#comment-me-root")) {
        ctx = { ...contextFromEditor(active), target: active };
      } else if (site) {
        const el = anchorEl?.closest(site.post) ||
          (hoveredPost && document.contains(hoveredPost) ? hoveredPost : null);
        if (el) await expand(el);
        ctx = el ? contextFromPost(el) : { post: "" };
      } else {
        ctx = { post: "", target: lastEditor };
      }
      if (selection) ctx.post = selection;
      openPanel(ctx);
    })();
  });
})();
