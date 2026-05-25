# Masques

## Présentation

Masques est une application web de guide touristique IA pour la Côte d'Ivoire. Elle combine un backend Python/FastAPI et un frontend HTML/CSS/JavaScript pour piloter un avatar LiveKit nommé **Yélé**.

## Architecture

### Backend

Fichier principal : `backend/main.py`

Le backend expose les routes suivantes :

- `POST /api/token` : génère un jeton de session LiveAvatar.
- `POST /api/session/start` : démarre une session LiveKit avec le jeton obtenu.
- `POST /api/session/stop` : arrête la session LiveKit.
- `POST /api/chat` : envoie l'historique de conversation à OpenAI avec `gpt-4o-mini` et retourne un flux SSE.
- `POST /api/transcribe` : envoie un fichier audio à OpenAI pour transcription avec `gpt-4o-transcribe`.

Le backend sert aussi le frontend statique avec :

- `app.mount('/', StaticFiles(directory='../frontend', html=True), name='frontend')`

> Important : lancez le serveur depuis le dossier `backend/` pour que le chemin vers `../frontend` soit résolu correctement.

### Frontend

Fichiers principaux :

- `frontend/index.html`
- `frontend/js/app.js`
- `frontend/css/style.css`

Le frontend propose :

- une page d'accueil multilingue (FR / EN / 中文),
- un écran de session LiveKit avec vidéo et audio,
- un champ de saisie texte,
- un bouton micro pour capturer la voix,
- la lecture en continu des réponses via LiveKit.

## Comportement principal

1. L'utilisateur choisit une langue et clique sur **Commencer la discussion**.
2. Le frontend appelle `POST /api/token` pour récupérer un `session_token` LiveAvatar.
3. Le frontend appelle `POST /api/session/start` pour obtenir `livekit_url` et `livekit_client_token`.
4. Le frontend connecte une session LiveKit et active l'interface.
5. L'utilisateur saisit un texte ou parle au micro.
6. Pour la voix, le frontend enregistre l'audio, l'envoie à `POST /api/transcribe`, puis récupère le texte transcrit.
7. Le texte est envoyé à `POST /api/chat` avec l'historique de conversation.
8. Le backend retourne un flux SSE OpenAI, le frontend assemble les fragments et publie des phrases vers LiveKit avec `avatar.speak_text`.

## Langues prises en charge

Le projet gère trois langues :

- `fr` (français)
- `en` (anglais)
- `zh` (chinois mandarin, code `zh-CN`)

La sélection de langue met à jour :

- le texte d'interface,
- les placeholders,
- les instructions de réponse envoyées à OpenAI,
- le paramètre `language` utilisé par `/api/token` et `/api/transcribe`.

## Variables d'environnement

Le backend s'appuie sur les variables suivantes :

- `LIVEAVATAR_API_KEY`
- `OPENAI_API_KEY`
- `AVATAR_ID`
- `VOICE_ID`
- `CONTEXT_ID`

Ces variables sont chargées via `python-dotenv` dans `backend/main.py`.

## Installation

### Prérequis

- Python 3.10+ ou 3.11+
- `pip`
- Clés API LiveAvatar et OpenAI

### Installation des dépendances

```bash
cd /Users/sismael/Documents/projects/masques/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuration

1. Créez un fichier `backend/.env`.
2. Ajoutez les clés suivantes :

```env
LIVEAVATAR_API_KEY=...
OPENAI_API_KEY=...
AVATAR_ID=...
VOICE_ID=...
CONTEXT_ID=...
```

## Lancement

```bash
cd /Users/sismael/Documents/projects/masques/backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Ouvrez ensuite :

- `http://localhost:8000/`

## Notes techniques

- Le backend utilise `gpt-4o-mini` pour la génération de texte et `gpt-4o-transcribe` pour la transcription audio.
- Le frontend publie les événements LiveKit `avatar.speak_text` et `avatar.interrupt` sur le topic `agent-control`.
- L'interface utilise `livekit-client@2.11.3`.
- La détection de silence et l'enregistrement audio sont gérés dans `frontend/js/app.js`.

## Fichiers clés

- `backend/main.py` : API FastAPI, routage OpenAI, sessions LiveAvatar.
- `backend/requirements.txt` : dépendances Python.
- `frontend/index.html` : page d'accueil et interface de session.
- `frontend/js/app.js` : logique de session, audio, transcription et LiveKit.
- `frontend/css/style.css` : styles de l'application.

## Améliorations possibles

- ajouter une page de résumé de conversation,
- améliorer la gestion des erreurs et les messages utilisateurs,
- sécuriser les clés API et ajouter un serveur de configuration.
