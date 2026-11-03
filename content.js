(() => {
  if (window.__commentMeLoaded) return;
  window.__commentMeLoaded = true;

  const host = location.hostname;
  const PLATFORM = /(^|\.)linkedin\.com$/.test(host)
    ? "linkedin"
    : /(^|\.)facebook\.com$/.test(host)
      ? "facebook"
      : "web";

  // Sélecteurs propres à chaque site. Ces sites changent souvent leur HTML :
  // c'est ici qu'il faut corriger si les boutons n'apparaissent plus.
  const SITES = {
    linkedin: {
      post: 'div.feed-shared-update-v2, div[data-urn^="urn:li:activity"], article.comments-comment-entity',
      text: [".update-components-text", ".feed-shared-inline-show-more-text", ".feed-shared-text", ".comments-comment-item__main-content"],
      author: [".update-components-actor__title span[aria-hidden='true']", ".update-components-actor__name", ".comments-comment-meta__description-title"],
      commentBtn: ["button[aria-label*='omment']"]
    },
    facebook: {
      post: 'div[role="article"]',
      text: ['div[data-ad-preview="message"]', 'div[data-ad-comet-preview="message"]', 'div[dir="auto"]'],
      author: ["h2 strong", "h3 strong", "h2 a", "h3 a", "strong"],
      commentBtn: ["div[role='button'][aria-label*='omment']", "div[role='button'][aria-label*='ommentaire']"]
    }
  };
  const site = SITES[PLATFORM];

  let lastEditor = null;   // dernière zone de commentaire où l'utilisateur a cliqué
  let hoveredPost = null;  // dernière publication survolée (pour le raccourci clavier)
  let settings = { showButtons: true };

  chrome.storage.local.get("cm_settings", ({ cm_settings }) => {
    settings = { ...settings, ...(cm_settings || {}) };
    if (site && settings.showButtons) startObserver();
  });

  // ---------- Suivi de la page ----------

  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (isEditor(t) && !t.closest?.("#comment-me-root")) lastEditor = t;
  }, true);

  if (site) {
    document.addEventListener("mouseover", (e) => {
      const p = e.target.closest?.(site.post);
      if (p) hoveredPost = p;
    }, { passive: true });
  }

  function isEditor(el) {
    return el && (el.isContentEditable || el.tagName === "TEXTAREA");
  }

  // ---------- Lecture d'une publication ----------

  function ownMatches(post, selectors) {
    for (const sel of selectors) {
      const found = [...post.querySelectorAll(sel)].filter((el) => el.closest(site.post) === post);
      if (found.length) return found;
    }
    return [];
  }

  function readPost(post) {
    if (!post) return { post: "", author: "" };
    let text = "";
    if (site) {
      const seen = new Set();
      text = ownMatches(post, site.text)
        .map((el) => el.innerText.trim())
        .filter((t) => t && !seen.has(t) && seen.add(t))
        .join("\n");
    }
    if (!text) text = post.innerText || "";
    text = text.replace(/…\s*(voir plus|see more|plus)\s*$/i, "").trim().slice(0, 5000);

    let author = "";
    if (site) author = (ownMatches(post, site.author)[0]?.innerText || "").trim().split("\n")[0];
    return { post: text, author: author.slice(0, 100) };
  }

  // ---------- Boutons sur les publications ----------

  function startObserver() {
    let pending = false;
    const scan = () => {
      pending = false;
      document.querySelectorAll(site.post).forEach(addButton);
    };
    new MutationObserver(() => {
      if (!pending) {
        pending = true;
        setTimeout(scan, 600);
      }
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  }

  function addButton(post) {
    if (post.dataset.cmDone) return;
    post.dataset.cmDone = "1";
    if (getComputedStyle(post).position === "static") post.style.position = "relative";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "✨";
    b.title = "Comment Me : proposer un commentaire";
    b.setAttribute("aria-label", "Proposer un commentaire");
    Object.assign(b.style, {
      position: "absolute", top: "6px", right: "52px", zIndex: "5",
      width: "30px", height: "30px", borderRadius: "50%", border: "1px solid #d0d7de",
      background: "#fff", cursor: "pointer", fontSize: "15px", lineHeight: "1",
      boxShadow: "0 1px 3px rgba(0,0,0,.15)", opacity: ".75", padding: "0"
    });
    b.addEventListener("mouseenter", () => (b.style.opacity = "1"));
    b.addEventListener("mouseleave", () => (b.style.opacity = ".75"));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel({ ...readPost(post), el: post });
    });
    post.appendChild(b);
  }

  // ---------- Insertion dans la zone de commentaire ----------

  function findEditor(post) {
    if (!post) return null;
    return post.querySelector('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"], [contenteditable="true"], textarea');
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

  async function insertComment(text, post) {
    let ed = findEditor(post);
    if (!ed && post && site) {
      const btn = ownMatches(post, site.commentBtn)[0];
      if (btn) {
        btn.click();
        ed = await waitFor(() => findEditor(post), 2500);
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
    // execCommand reste la méthode la plus fiable avec les éditeurs de FB (Lexical) et LinkedIn (Quill).
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
    header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: #4f46e5; color: #fff; }
    header b { flex: 1; font-size: 15px; }
    header button { background: transparent; border: 0; color: #fff; font-size: 18px; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    header button:hover { background: rgba(255,255,255,.18); }
    .body { padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    label { font-size: 12px; font-weight: 600; color: #57606a; }
    textarea, input { width: 100%; border: 1px solid #d0d7de; border-radius: 8px; padding: 8px; font-size: 13px; color: #1d2129; background: #fff; resize: vertical; }
    textarea:focus, input:focus { outline: 2px solid #a5b4fc; border-color: #4f46e5; }
    .post { min-height: 60px; max-height: 120px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1px solid #d0d7de; background: #fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #1d2129; }
    .chip.on { background: #eef2ff; border-color: #4f46e5; color: #3730a3; font-weight: 600; }
    .go { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .go:disabled { opacity: .6; cursor: wait; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: #fafafa; }
    .card textarea { background: #fff; min-height: 60px; }
    .row { display: flex; gap: 6px; justify-content: flex-end; }
    .row button { border: 1px solid #d0d7de; background: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; color: #1d2129; }
    .row button.main { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }
    .err { background: #fff1f0; border: 1px solid #ffccc7; color: #a8071a; border-radius: 8px; padding: 8px; font-size: 13px; }
    .err a { color: #a8071a; font-weight: 600; cursor: pointer; text-decoration: underline; }
    .note { font-size: 12px; color: #57606a; text-align: center; }
    .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid #fff; border-right-color: transparent; border-radius: 50%; animation: s .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
    @keyframes s { to { transform: rotate(360deg); } }
  `;

  const INTENTS = [
    ["auto", "Auto"], ["court et direct", "Court"], ["chaleureux", "Chaleureux"],
    ["professionnel", "Pro"], ["avec une pointe d'humour", "Drôle"],
    ["remerciement", "Merci"], ["félicitations", "Bravo"], ["qui pose une question", "Question"]
  ];

  function openPanel({ post = "", author = "", el = null }) {
    closePanel();
    const hostEl = document.createElement("div");
    hostEl.id = "comment-me-root";
    const root = hostEl.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap" role="dialog" aria-label="Comment Me">
        <header><b>✨ Comment Me</b>
          <button class="opt" title="Réglages">⚙</button>
          <button class="x" title="Fermer (Échap)">✕</button></header>
        <div class="body">
          <div><label>Publication${author ? " de " + escapeHTML(author) : ""}</label>
            <textarea class="post" placeholder="Colle ou sélectionne le texte de la publication…"></textarea></div>
          <div class="chips">${INTENTS.map(([v, l], i) => `<button class="chip${i ? "" : " on"}" data-v="${escapeHTML(v)}">${l}</button>`).join("")}</div>
          <input class="extra" placeholder="Consigne en plus (optionnel) : ex. « mentionne notre projet commun »">
          <button class="go">Proposer des commentaires</button>
          <div class="out"></div>
          <div class="note">Rien n'est publié automatiquement : c'est toi qui cliques sur « Publier ».</div>
        </div>
      </div>`;
    document.documentElement.appendChild(hostEl);

    const $ = (s) => root.querySelector(s);
    $(".post").value = post;
    let intent = "auto";

    root.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        root.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        intent = c.dataset.v;
      })
    );
    $(".x").addEventListener("click", closePanel);
    $(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
    $(".extra").addEventListener("keydown", (e) => e.key === "Enter" && run());
    $(".go").addEventListener("click", run);
    root.addEventListener("keydown", (e) => e.stopPropagation()); // évite les raccourcis du site pendant la saisie

    async function run() {
      const go = $(".go");
      const out = $(".out");
      const text = $(".post").value.trim();
      if (!text) {
        out.innerHTML = `<div class="err">Aucun texte de publication. Sélectionne-le ou colle-le ci-dessus.</div>`;
        return;
      }
      go.disabled = true;
      go.innerHTML = `<span class="spin"></span>Rédaction en cours…`;
      out.innerHTML = "";
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: "cm-generate", platform: PLATFORM, post: text, author,
          intent, extra: $(".extra").value.trim()
        });
      } catch {
        res = { error: "L'extension a été mise à jour : recharge la page (F5)." };
      }
      go.disabled = false;
      go.textContent = "Régénérer";
      if (!res || res.error) {
        out.innerHTML = `<div class="err">${escapeHTML(res?.error || "Erreur inconnue")}<br><a class="o2">Ouvrir les réglages</a></div>`;
        out.querySelector(".o2").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cm-open-options" }));
        return;
      }
      out.style.display = "flex";
      out.style.flexDirection = "column";
      out.style.gap = "8px";
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
          const r = await insertComment(ta.value, el);
          if (r === "copied") {
            flash(e.target, "Copié, colle-le (Ctrl+V)", 2500);
          } else {
            closePanel();
          }
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
    if (msg.type === "cm-open") {
      const selection = (msg.text || getSelection().toString()).trim();
      // Publication contenant la sélection, sinon celle où l'on écrit, sinon la dernière survolée.
      let el = null;
      if (site) {
        const anchor = getSelection().anchorNode;
        el = (anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest(site.post)) ||
          document.activeElement?.closest?.(site.post) ||
          (hoveredPost && document.contains(hoveredPost) ? hoveredPost : null);
      }
      const data = el ? readPost(el) : { post: "", author: "" };
      openPanel({ post: selection || data.post, author: data.author, el });
    }
  });
})();
