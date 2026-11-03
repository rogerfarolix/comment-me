# ✨ Comment Me

Extension de navigateur qui **lit une publication Facebook ou LinkedIn et te propose des commentaires écrits dans ton propre style**. Tu choisis, tu modifies si besoin, et **c'est toi qui publies** : l'extension ne publie jamais rien toute seule.

Tu utilises **ta propre clé API** : aucun serveur intermédiaire, aucun abonnement. Plusieurs IA **gratuites** sont prises en charge.

## Fonctionnalités

- Bouton ✨ sur chaque publication (et chaque commentaire) Facebook et LinkedIn
- Clic droit sur un texte sélectionné → « Proposer un commentaire » (fonctionne sur **tous les sites**)
- Raccourci clavier **Alt+Maj+C** sur la publication survolée
- Plusieurs propositions avec des tons au choix : court, chaleureux, pro, drôle, remerciement, félicitations, question
- Imitation de ton style à partir de tes vrais commentaires, avec analyse automatique du style
- Bouton « Insérer » qui remplit la zone de commentaire. Tu n'as plus qu'à publier.

## Fournisseurs d'IA

| Fournisseur | Prix | Clé |
|---|---|---|
| Google Gemini | Gratuit (quotas journaliers) | https://aistudio.google.com/apikey |
| Groq | Gratuit (limites par minute) | https://console.groq.com/keys |
| OpenRouter (modèles `:free`) | Gratuit | https://openrouter.ai/keys |
| Mistral AI (offre Experiment) | Gratuit | https://console.mistral.ai/api-keys |
| Ollama | Gratuit, local | https://ollama.com |
| OpenAI | Payant | https://platform.openai.com/api-keys |
| Anthropic Claude | Payant | https://console.anthropic.com/settings/keys |
| Toute API compatible OpenAI | Variable | : |

> Sur les offres gratuites, certains fournisseurs (dont Google) peuvent utiliser les requêtes pour améliorer leurs modèles. Pour une confidentialité totale, utilise Ollama en local.

## Installation (mode développeur)

Compatible avec **Chrome, Edge, Brave, Opera, Vivaldi** et tous les navigateurs basés sur Chromium.

1. Télécharge ou clone ce dépôt.
2. Ouvre la page des extensions :
   - Chrome : `chrome://extensions`
   - Edge : `edge://extensions`
   - Brave : `brave://extensions`
   - Opera : `opera://extensions`
3. Active le **Mode développeur**.
4. Clique sur **Charger l'extension non empaquetée** et choisis ce dossier.
5. La page de réglages s'ouvre : choisis ton IA, colle ta clé et ajoute des exemples de tes commentaires.

## Utiliser Ollama (100 % local)

Ollama refuse par défaut les requêtes venant d'une extension. Lance-le avec :

```bash
# Windows (PowerShell)
$env:OLLAMA_ORIGINS="chrome-extension://*"; ollama serve
# macOS / Linux
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

## Confidentialité

- Ta clé API et tes réglages restent dans `chrome.storage.local`, sur ton ordinateur.
- Le texte d'une publication n'est envoyé à l'IA choisie **que lorsque tu demandes** une proposition.
- Aucune télémétrie, aucun serveur tiers.

## Structure

```
manifest.json   Déclaration de l'extension (Manifest V3)
background.js   Menus, raccourci, appels aux API d'IA, construction du prompt
content.js      Boutons sur les publications, lecture du texte, fenêtre de propositions, insertion
providers.js    Liste des fournisseurs et réglages par défaut
options.*       Page de réglages
```

## Ça ne marche plus sur Facebook ou LinkedIn ?

Ces sites changent régulièrement leur code HTML. Les sélecteurs se trouvent en haut de `content.js` (objet `SITES`). En attendant une correction, le **clic droit sur un texte sélectionné** fonctionne toujours.

Les contributions sont les bienvenues : ouvre une issue ou une pull request.

## Licence

MIT
