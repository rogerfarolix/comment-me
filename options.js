const $ = (id) => document.getElementById(id);
let s;

function fillProvider() {
  const p = CM_PROVIDERS[s.provider];
  $("hint").textContent = p.hint;
  $("keyRow").hidden = !!p.noKey;
  $("key").value = s.keys[s.provider] || "";
  $("keyLink").href = p.keyUrl || "#";
  $("keyLink").hidden = !p.keyUrl;
  $("urlRow").hidden = !(s.provider === "custom" || s.provider === "ollama");
  $("baseUrl").value = s.baseUrls[s.provider] || p.baseUrl || "";
  $("model").value = s.models[s.provider] || "";
  $("model").placeholder = p.model || "nom-du-modèle";
}

// Garde en mémoire ce qui est saisi pour le fournisseur courant.
function readProvider() {
  s.keys[s.provider] = $("key").value.trim();
  s.models[s.provider] = $("model").value.trim();
  if (!$("urlRow").hidden) s.baseUrls[s.provider] = $("baseUrl").value.trim();
}

function readForm() {
  readProvider();
  s.language = $("language").value;
  s.count = parseInt($("count").value);
  s.styleExamples = $("examples").value;
  s.styleNotes = $("notes").value;
  s.showButtons = $("showButtons").checked;
}

function status(id, text, ok) {
  $(id).textContent = text;
  $(id).className = "status " + (ok ? "ok" : "ko");
}

async function save() {
  readForm();
  // URL personnalisée : demande l'autorisation d'y accéder.
  const url = s.baseUrls[s.provider];
  if (url && !$("urlRow").hidden) {
    try {
      const origin = new URL(url).origin + "/*";
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted && !/localhost|127\.0\.0\.1/.test(origin)) {
        status("saved", "Autorisation refusée pour cette URL.", false);
        return false;
      }
    } catch {
      status("saved", "URL de l'API invalide.", false);
      return false;
    }
  }
  await chrome.storage.local.set({ cm_settings: s });
  status("saved", "Enregistré ✓", true);
  setTimeout(() => ($("saved").textContent = ""), 2000);
  return true;
}

async function init() {
  s = await cmGetSettings();
  s.keys = { ...s.keys };
  s.models = { ...s.models };
  s.baseUrls = { ...s.baseUrls };

  $("provider").innerHTML = Object.entries(CM_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
    .join("");
  $("provider").value = s.provider;
  $("language").value = s.language;
  $("count").value = String(s.count);
  $("examples").value = s.styleExamples;
  $("notes").value = s.styleNotes;
  $("showButtons").checked = s.showButtons;
  fillProvider();

  $("provider").addEventListener("change", () => {
    readProvider();
    s.provider = $("provider").value;
    fillProvider();
  });

  $("toggleKey").addEventListener("click", () => {
    const show = $("key").type === "password";
    $("key").type = show ? "text" : "password";
    $("toggleKey").textContent = show ? "Masquer" : "Afficher";
  });

  $("save").addEventListener("click", save);

  $("test").addEventListener("click", async () => {
    if (!(await save())) return;
    $("test").disabled = true;
    status("testResult", "Test en cours…", true);
    const r = await chrome.runtime.sendMessage({
      type: "cm-generate", platform: "linkedin", author: "Test",
      post: "Je suis ravi d'annoncer que je rejoins une nouvelle équipe à partir de lundi !"
    });
    $("test").disabled = false;
    if (r?.error) status("testResult", r.error, false);
    else status("testResult", "Ça marche ✓ Exemple : « " + r.suggestions[0] + " »", true);
  });

  $("analyze").addEventListener("click", async () => {
    if (!(await save())) return;
    $("analyze").disabled = true;
    status("analyzeResult", "Analyse en cours…", true);
    const r = await chrome.runtime.sendMessage({ type: "cm-analyze-style", examples: $("examples").value });
    $("analyze").disabled = false;
    if (r?.error) return status("analyzeResult", r.error, false);
    $("notes").value = r.notes;
    status("analyzeResult", "Style analysé ✓ Relis et ajuste, puis enregistre.", true);
  });
}

init();
