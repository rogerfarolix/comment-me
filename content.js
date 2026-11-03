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
      author: ["h2 strong", "h3 strong", "h4 strong", "h2 a", "h3 a", "strong"],
      commentBtn: ["div[role='button'][aria-label*='omment']"]
    }
  };
  const site = SITES[PLATFORM];

  // Lignes d'interface à retirer du texte lu (boutons, compteurs, dates…).
  const NOISE = /^(j['’]aime|like|réagir|react|commenter|comment|partager|share|répondre|reply|envoyer|send|republier|repost|suivre|follow|\+ suivre|se connecter|connect|voir (plus|moins|la traduction|les \d+ réponses?|plus de commentaires)|see (more|less|translation)|…\s*(plus|more)|modifié|edited|auteur|author|\d+[\s ]*(j|h|min|sem|s|m|d|w|an|ans|mo|y|yr)s?\.?|·|•|\d[\d\s ,.k]*(j['’]aime|réactions?|commentaires?|partages?|comments?|reactions?|reposts?|shares?|likes?)?|\d+e?|1er|2e|3e\+?|plus pertinents|most relevant|tous les commentaires|all comments)$/i;

  let lastEditor = null;
  let hoveredPost = null;
  let settings = { showButtons: true };

  chrome.storage.local.get("cm_settings", ({ cm_settings }) => {
    settings = { ...settings, ...(cm_settings || {}) };
    if (site && settings.showButtons) startObserver();
  });

  // ---------- Bouton ✨ dans la zone de commentaire ----------

  const fab = document.createElement("button");
  fab.type = "button";
  fab.textContent = "✨";
  fab.title = "Comment Me : proposer un commentaire (Alt+Maj+C)";
  fab.setAttribute("aria-label", "Proposer un commentaire");
  Object.assign(fab.style, {
    position: "fixed", zIndex: "2147483646", display: "none",
    width: "28px", height: "28px", borderRadius: "50%", border: "0", padding: "0",
    background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", cursor: "pointer",
    fontSize: "14px", lineHeight: "28px", boxShadow: "0 2px 8px rgba(79,70,229,.45)"
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
    fab.style.display = "block";
  }

  if (site) {
    document.addEventListener("focusin", (e) => {
      const t = e.target;
      if (!isEditor(t) || t.closest?.("#comment-me-root")) return;
      lastEditor = t;
      if (!fab.isConnected) document.documentElement.appendChild(fab);
      placeFab();
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
    if (commentEl && commentEl !== postEl) {
      ctx.comment = cleanText(commentEl, ed).slice(0, 1500);
      ctx.commentAuthor = authorOf(commentEl);
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
    return { post: readBlock(postEl), author: authorOf(postEl), comment: "", commentAuthor: "", el: postEl };
  }

  // ---------- Bouton ✨ sur chaque publication ----------

  function startObserver() {
    let pending = false;
    const scan = () => {
      pending = false;
      document.querySelectorAll(site.post).forEach(addButton);
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
    b.textContent = "✨";
    b.title = "Comment Me : proposer un commentaire";
    b.setAttribute("aria-label", "Proposer un commentaire");
    Object.assign(b.style, {
      position: "absolute", top: "8px", right: "88px", zIndex: "5",
      width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #d0d7de",
      background: "#fff", cursor: "pointer", fontSize: "14px", lineHeight: "1",
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
    header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; }
    header b { flex: 1; font-size: 15px; }
    header button { background: transparent; border: 0; color: #fff; font-size: 17px; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    header button:hover { background: rgba(255,255,255,.18); }
    .body { padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    details { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 10px; background: #fafafa; }
    summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #57606a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
    .note { font-size: 11px; color: #8b949e; text-align: center; }
  `;

  const INTENTS = [
    ["auto", "Auto"], ["court et direct", "Court"], ["chaleureux", "Chaleureux"],
    ["professionnel", "Pro"], ["avec une pointe d'humour", "Drôle"],
    ["remerciement", "Merci"], ["félicitations", "Bravo"], ["qui pose une question", "Question"]
  ];

  function openPanel(ctx) {
    closePanel();
    const { post = "", author = "", comment = "", commentAuthor = "" } = ctx;
    const hostEl = document.createElement("div");
    hostEl.id = "comment-me-root";
    const root = hostEl.attachShadow({ mode: "open" });
    const firstLine = post.split("\n").find((l) => l.length > 15 && l !== author) || post.split("\n")[0] || "";
    const summary = post ? `${author ? author + " : " : ""}${firstLine.slice(0, 70)}` : "";
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap" role="dialog" aria-label="Comment Me">
        <header><b>✨ Comment Me</b>
          <button class="opt" title="Réglages">⚙</button>
          <button class="x" title="Fermer (Échap)">✕</button></header>
        <div class="body">
          ${comment ? `<div class="reply">↪ Réponse à ${escapeHTML(commentAuthor || "un commentaire")} : ${escapeHTML(comment.slice(0, 200))}</div>` : ""}
          <details ${post ? "" : "open"}>
            <summary>${post ? "📄 " + escapeHTML(summary) : "📄 Texte de la publication"}</summary>
            <textarea class="post" placeholder="Sélectionne ou colle le texte de la publication…"></textarea>
          </details>
          <div class="chips">${INTENTS.map(([v, l], i) => `<button class="chip${i ? "" : " on"}" data-v="${escapeHTML(v)}">${l}</button>`).join("")}</div>
          <input class="extra" placeholder="Consigne en plus (optionnel), puis Entrée">
          <button class="go">Proposer des commentaires</button>
          <div class="out"></div>
          <div class="note">Rien n'est publié automatiquement : c'est toi qui publies.</div>
        </div>
      </div>`;
    document.documentElement.appendChild(hostEl);

    const $ = (s) => root.querySelector(s);
    $(".post").value = post;
    let intent = "auto";
    let runId = 0;

    root.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        root.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        intent = c.dataset.v;
        if ($(".post").value.trim()) run();
      })
    );
    $(".x").addEventListener("click", closePanel);
    $(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
    $(".extra").addEventListener("keydown", (e) => e.key === "Enter" && run());
    $(".go").addEventListener("click", run);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
      e.stopPropagation(); // évite les raccourcis du site pendant la saisie
    });

    async function run() {
      const id = ++runId;
      const go = $(".go");
      const out = $(".out");
      const text = $(".post").value.trim();
      if (!text) {
        out.innerHTML = `<div class="err">Aucun texte trouvé. Sélectionne-le ou colle-le dans « Texte de la publication ».</div>`;
        $("details").open = true;
        return;
      }
      go.disabled = true;
      go.textContent = "Rédaction…";
      out.innerHTML = `<div class="skel"></div><div class="skel"></div>`;
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: "cm-generate", platform: PLATFORM, post: text, author, comment, commentAuthor,
          intent, extra: $(".extra").value.trim()
        });
      } catch {
        res = { error: "L'extension a été mise à jour : recharge la page (F5)." };
      }
      if (id !== runId || !panel) return;
      go.disabled = false;
      go.textContent = "↻ Régénérer";
      if (!res || res.error) {
        out.innerHTML = `<div class="err">${escapeHTML(res?.error || "Erreur inconnue")}<br><a class="o2">Ouvrir les réglages</a></div>`;
        out.querySelector(".o2").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
        return;
      }
      out.innerHTML = "";
      res.suggestions.forEach((s) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<textarea rows="3"></textarea>
          <div class="row"><button class="cp">Copier</button><button class="main ins">Insérer</button></div>`;
        const ta = card.querySelector("textarea");
        ta.value = s;
        card.querySelector(".cp").addEventListener("click", async (e) => {
          await copy(ta.value);
          flash(e.target, "Copié ✓");
        });
        card.querySelector(".ins").addEventListener("click", async (e) => {
          const r = await insertComment(ta.value, ctx);
          if (r === "copied") flash(e.target, "Copié : colle avec Ctrl+V", 2500);
          else closePanel();
        });
        out.appendChild(card);
      });
    }

    function onKey(e) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", onKey);
    panel = { hostEl, onKey };

    if (post) run();
    else $(".post").focus();
  }

  function closePanel() {
    if (!panel) return;
    document.removeEventListener("keydown", panel.onKey);
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
