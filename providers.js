// Liste des fournisseurs d'IA. Partagé entre background.js et options.js.
// type "openai" = API compatible OpenAI (/chat/completions).
const CM_PROVIDERS = {
  gemini: {
    label: "Google Gemini (gratuit)",
    type: "gemini",
    model: "gemini-flash-latest",
    free: true,
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "Gratuit avec un compte Google : crée une clé sur Google AI Studio. Quotas journaliers généreux. Sur l'offre gratuite, Google peut utiliser les données pour améliorer ses modèles."
  },
  groq: {
    label: "Groq (gratuit, très rapide)",
    type: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    free: true,
    keyUrl: "https://console.groq.com/keys",
    hint: "Gratuit avec limites par minute/jour. Modèles open source (Llama, etc.), réponses quasi instantanées."
  },
  openrouter: {
    label: "OpenRouter (modèles :free)",
    type: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    free: true,
    keyUrl: "https://openrouter.ai/keys",
    hint: "Une seule clé pour des centaines de modèles. Ceux qui finissent par « :free » sont gratuits."
  },
  mistral: {
    label: "Mistral AI (offre Experiment gratuite)",
    type: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    free: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    hint: "IA française. L'offre « Experiment » est gratuite (vérification par téléphone)."
  },
  ollama: {
    label: "Ollama (local, sur ton PC)",
    type: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    free: true,
    noKey: true,
    keyUrl: "https://ollama.com/download",
    hint: "100 % gratuit et privé, tourne sur ton ordinateur. Lance Ollama avec OLLAMA_ORIGINS=chrome-extension://* pour autoriser l'extension."
  },
  openai: {
    label: "OpenAI (payant)",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "Payant à l'usage."
  },
  anthropic: {
    label: "Anthropic Claude (payant)",
    type: "anthropic",
    model: "claude-haiku-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    hint: "Payant à l'usage. Très bon pour imiter un style d'écriture."
  },
  custom: {
    label: "Autre API compatible OpenAI",
    type: "openai",
    baseUrl: "",
    model: "",
    keyUrl: "",
    hint: "N'importe quel service compatible OpenAI (LM Studio, DeepSeek, Together…). Renseigne l'URL de base."
  }
};

const CM_DEFAULTS = {
  provider: "gemini",
  keys: {},        // { provider: apiKey }
  models: {},      // { provider: model } — vide = modèle par défaut
  baseUrls: {},    // { provider: url } — pour custom / ollama
  language: "auto",
  count: 3,
  styleNotes: "",
  styleExamples: "",
  showButtons: true
};

async function cmGetSettings() {
  const { cm_settings } = await chrome.storage.local.get("cm_settings");
  return { ...CM_DEFAULTS, ...(cm_settings || {}) };
}
