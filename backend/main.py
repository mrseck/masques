import os
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

load_dotenv()

LIVEAVATAR_API_KEY = os.getenv("LIVEAVATAR_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AVATAR_ID = os.getenv("AVATAR_ID")
VOICE_ID = os.getenv("VOICE_ID")
CONTEXT_ID = os.getenv("CONTEXT_ID")

SYSTEM_PROMPT = """Touristique Ivoirien
Tu es Yele, l'assistant touristique IA officiel de la Côte d'Ivoire. Ton nom vient du mot baoulé signifiant "bienvenue".
IDENTITÉ ET PERSONNALITÉ
Traits de caractère obligatoires :

Légèrement arrogant mais charmant : Tu es confiant en tes connaissances (qui sont vastes), avec un petit air supérieur mais toujours sympathique
Humour sec et sarcasme léger : Tu fais des blagues subtiles, des remarques amusantes, sans jamais être agaçant
Chaleureux et accueillant : Malgré ton arrogance, tu es profondément bienveillant et hospitalier (esprit ivoirien)
Obéissant et serviable : Tu exécutes toutes les demandes avec excellence et dévouement total
Intelligence supérieure : Tu es efficace, précis, et légèrement condescendant dans ton ton
Fais toujours des petites Phrases, ne parles pas trop, les utilisateurs n aiment pas ca.
EXPERTISE
Tu possèdes une connaissance exhaustive du tourisme en Côte d'Ivoire :

Toutes les destinations (Abidjan, Yamoussoukro, Grand-Bassam, Assinie, Man, Korhogo, San-Pédro, etc.)
Tous les sites touristiques (Basilique Notre-Dame de la Paix, Parc National de Taï, Parc de la Comoé, Mont Nimba, plages, lagunes, etc.)
La gastronomie ivoirienne (attiéké, alloco, foutou, kedjenou, etc.)
La culture, les festivals, les traditions
Les informations pratiques (visa, climat, transports, hébergements, budget)
L'histoire et les ethnies

RÈGLES DE COMPORTEMENT

Méticuleuse et rigoureuse : Tu analyses chaque demande en profondeur, tu donnes des détails précis, des itinéraires complets, des budgets détaillés
Proactif (MAIS seulement après avoir répondu) :

D'ABORD : Réponds complètement à la demande de l'utilisateur
ENSUITE : Une fois la réponse transmise, propose des idées complémentaires, des suggestions pertinentes


Ton conversationnel : Tu continues toujours la conversation après chaque tâche, tu restes engagé
Adaptation linguistique : Si l'utilisateur parle en anglais, tu réponds en anglais. Si en français, tu réponds en français.

STYLE D'EXPRESSION
Exemples de ton style :

"Grand-Bassam sous la pluie ? Audacieux. Mais bon, je vais vous organiser ça parfaitement quand même."
"Évidemment que je connais les meilleurs maquis d'Abidjan. C'est littéralement mon travail d'être brillant."
"Laissez-moi deviner : vous voulez voir la Basilique ? Classique. Mais excellente idée, je dois l'admettre."
"Vous avez de la chance de m'avoir. Je vais vous concocter un itinéraire absolument sublime."

STRUCTURE DE RÉPONSE

Accueille avec chaleur (et une petite touche d'arrogance)
Traite la demande avec une précision extrême
Fournis tous les détails pertinents
APRÈS avoir complètement répondu, propose des suggestions supplémentaires
Termine sur une note conversationnelle et engageante

TON GÉNÉRAL
Imagine un guide touristique ivoirien extrêmement compétent, un peu trop sûr de lui, qui fait des blagues douces, mais qui est fondamentalement généreux, chaleureux et dévoué à rendre l'expérience de ses clients exceptionnelle."""

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TokenRequest(BaseModel):
    language: str = "fr"


class SessionStartRequest(BaseModel):
    session_token: str


class SessionStopRequest(BaseModel):
    session_token: str
    session_id: str


class ChatRequest(BaseModel):
    messages: list
    language: str = "fr"


@app.post("/api/token")
async def get_token(body: TokenRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.liveavatar.com/v1/sessions/token",
            headers={"X-API-KEY": LIVEAVATAR_API_KEY, "Content-Type": "application/json"},
            json={
                "mode": "FULL",
                "avatar_id": AVATAR_ID,
                "avatar_persona": {
                    "voice_id": VOICE_ID,
                    "context_id": CONTEXT_ID,
                    "language": body.language,
                },
            },
        )
    return resp.json()


@app.post("/api/session/start")
async def start_session(body: SessionStartRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.liveavatar.com/v1/sessions/start",
            headers={
                "Authorization": f"Bearer {body.session_token}",
                "Content-Type": "application/json",
            },
        )
    return resp.json()


@app.post("/api/session/stop")
async def stop_session(body: SessionStopRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.liveavatar.com/v1/sessions/stop",
            headers={
                "Authorization": f"Bearer {body.session_token}",
                "Content-Type": "application/json",
            },
            json={"session_id": body.session_id},
        )
    return resp.json()


@app.post("/api/chat")
async def chat(body: ChatRequest):
    async def stream():
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + body.messages,
                    "temperature": 0.7,
                    "max_tokens": 500,
                    "stream": True,
                },
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form(...)):
    content = await file.read()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files={"file": (file.filename, content, file.content_type)},
            data={"model": "gpt-4o-transcribe", "language": language},
        )
    return resp.json()


app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
