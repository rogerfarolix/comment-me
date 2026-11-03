<p align="center"><img src="icons/logo.svg" width="96" alt="Comment Me"></p>

# Comment Me

Extension de navigateur qui **lit une publication Facebook ou LinkedIn et te propose des commentaires écrits dans ton propre style**. Tu choisis, tu modifies si besoin, et **c'est toi qui publies** : l'extension ne publie jamais rien toute seule.

Tu utilises **ta propre clé API** : aucun serveur intermédiaire, aucun abonnement. Plusieurs IA **gratuites** sont prises en charge.

## Fonctionnalités

- **Propositions prêtes à l'avance** : clique dans une zone de commentaire, l'IA commence à rédiger tout de suite. Le ✨ devient vert quand c'est prêt.
- **Affichage mot à mot** : le texte apparaît pendant qu'il s'écrit.
- **Lecture automatique** de la publication et du commentaire auquel tu réponds, sans copier-coller (clique sur « Voir plus » si besoin).
- **Reconnaît quand c'est toi qui es tagué.**
- **Mode Notifications** : sur ta page de notifications, le bouton « ✨ Répondre aux tags » prépare une réponse pour chaque mention.
- **Lecture des images** des publications (avec Gemini, OpenAI, Claude ou un modèle « vision »).
- **Apprentissage de ton style** à partir de tes exemples, d'une analyse automatique et des commentaires que tu publies vraiment.
- Tons au choix : court, chaleureux, pro, drôle, merci, bravo, question.
- Clic droit sur un texte sélectionné → « Proposer un commentaire » (fonctionne sur **tous les sites**).
- Raccourci **Alt+Maj+C**.
- Bouton « Insérer » qui remplit la zone de commentaire. **C'est toi qui publies.**

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

### Firefox (128 ou plus récent)

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. Clique sur **Charger un module complémentaire temporaire** et choisis le fichier `manifest.json`.
3. Dans `about:addons` → Comment Me → **Permissions**, autorise l'accès aux sites.

Pour une installation permanente, il faudra passer par la version publiée sur addons.mozilla.org.

## Pour les développeurs

```bash
npm run lint     # vérification Mozilla (web-ext)
npm run build    # crée dist/comment_me-x.y.z.zip, à envoyer au Chrome Web Store, à Edge Add-ons et à Firefox Add-ons
npm run firefox  # lance Firefox avec l'extension
```

La fiche boutique et la justification des permissions se trouvent dans `store/LISTING.md`, et la politique de confidentialité dans `PRIVACY.md`.

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
- Le texte (et les images) d'une publication ne sont envoyés à l'IA choisie que lorsque tu demandes une proposition, ou quand tu cliques dans une zone de commentaire si « Préparer à l'avance » est activé.
- Voir [PRIVACY.md](PRIVACY.md).
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
