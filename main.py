"""Standalone backend code extracted from the former shared FastAPI server."""

import json
import os
from io import BytesIO
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from google.cloud import speech_v1p1beta1 as speech
from google.cloud import texttospeech
from google.oauth2 import service_account
from openai import OpenAI
from pydantic import BaseModel
from starlette.staticfiles import StaticFiles


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"

# Local development reads .env; deployed environment variables take precedence.
load_dotenv(PROJECT_ROOT / ".env")

app = FastAPI()
api_router = APIRouter(prefix="/api")


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


OPENAI_API_KEY = required_env("OPENAI_API_KEY")
GOOGLE_APPLICATION_CREDENTIALS_JSON = required_env(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON"
)
google_credentials = service_account.Credentials.from_service_account_info(
    json.loads(GOOGLE_APPLICATION_CREDENTIALS_JSON)
)
speech_client = speech.SpeechClient(credentials=google_credentials)
tts_client = texttospeech.TextToSpeechClient(credentials=google_credentials)


class ChatBot:
    def __init__(self) -> None:
        self.client = OpenAI(api_key=OPENAI_API_KEY)
        self.questions: list[str] = []
        self.answers: list[str | None] = []
        self.answer_indices: list[int | None] = []
        self.question_embeddings: np.ndarray | None = None
        self.history_store: dict[str, list[dict[str, str]]] = {}
        self.initialized = False

    def initialize(self, filename: str) -> None:
        if self.initialized:
            return

        filepath = DATA_DIR / filename
        if not filepath.is_file():
            raise FileNotFoundError(f"Knowledge-base file not found: {filepath}")

        dataframe = pd.read_csv(filepath)
        current_answer = None
        current_index = None

        for _, row in dataframe.iterrows():
            if pd.notna(row["answer_index"]):
                current_index = int(row["answer_index"])
                current_answer = row["answer"]

            question = row["question"]
            if pd.notna(question):
                self.questions.append(question)
                self.answers.append(current_answer)
                self.answer_indices.append(current_index)

        embeddings: list[list[float]] = []
        for start in range(0, len(self.questions), 1000):
            response = self.client.embeddings.create(
                model="text-embedding-3-small",
                input=self.questions[start : start + 1000],
            )
            embeddings.extend(item.embedding for item in response.data)

        self.question_embeddings = np.array(embeddings, dtype=np.float32)
        norms = np.linalg.norm(self.question_embeddings, axis=1, keepdims=True)
        self.question_embeddings /= np.clip(norms, 1e-8, None)
        self.initialized = True

    def history(self, session_id: str) -> list[dict[str, str]]:
        return self.history_store.setdefault(session_id, [])

    def rewrite_query(self, message: str, history: list[dict[str, str]]) -> str:
        history_text = "\n".join(
            f"{item['role']}: {item['content']}" for item in history[-6:]
        ) or "None"
        response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": """
You convert user messages into standalone questions for a retrieval system.

Your goal is to preserve the original wording as much as possible.

Only modify the message if it depends on the conversation history
to be understood (for example: pronouns like "it", "that", "they",
or vague references).

If the user's message is already clear and understandable on its own,
return it EXACTLY as written.

Instructions:
- Use the conversation history only when the message contains a
  reference that cannot be understood without context.
- When rewriting is necessary, change as little wording as possible.
- Do NOT paraphrase or improve the question.
- Do NOT replace pronouns like "you" with names unless required
  to resolve ambiguity.

Output rules:
- Return exactly ONE question.
- Preserve the original wording whenever possible.
- Do not include explanations.
- Do not include quotation marks.
- Do not include prefixes or extra text.
""",
                },
                {
                    "role": "user",
                    "content": f"Conversation history:\n{history_text}\n\nUser message:\n{message}",
                },
            ],
        )
        return response.choices[0].message.content.strip()

    def handle_exact_chat(self, session_id: str, message: str) -> dict[str, int | float | str]:
        history = self.history(session_id)[-6:]
        query = self.rewrite_query(message, history)
        response = self.client.embeddings.create(model="text-embedding-3-small", input=query)
        query_embedding = np.array(response.data[0].embedding)
        query_embedding /= np.linalg.norm(query_embedding)

        if self.question_embeddings is None:
            raise RuntimeError("Bot is not initialized")
        similarities = self.question_embeddings @ query_embedding
        indices = np.argsort(similarities)[-5:][::-1]
        similarity = float(similarities[indices[0]])

        answer_index = None
        answer = None
        for index in indices:
            candidate = self.answers[index]
            if candidate is not None:
                answer_index = self.answer_indices[index]
                answer = candidate
                break

        if similarity < 0.5 or answer is None:
            answer_index = -1
            answer = "I'm not sure how to answer that."

        conversation = self.history(session_id)
        conversation.extend(
            [
                {"role": "user", "content": message},
                {"role": "assistant", "content": answer},
            ]
        )
        return {
            "answer_index": answer_index if answer_index is not None else -1,
            "answer": answer,
            "similarity": similarity,
        }


bots = {"juangomez": ChatBot()}


class ChatRequest(BaseModel):
    session_id: str
    message: str


def get_bot(bot_id: str) -> ChatBot:
    bot = bots.get(bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    if not bot.initialized:
        bot.initialize(f"{bot_id}.csv")
    return bot


@api_router.post("/{bot_id}/chat_exact")
def chat_exact(bot_id: str, request: ChatRequest) -> dict[str, int | float | str]:
    return get_bot(bot_id).handle_exact_chat(request.session_id, request.message)


class TextToSpeechRequest(BaseModel):
    text: str
    language_code: str
    voice_name: str


def transcribe_audio(audio_bytes: bytes, content_type: str | None, language_code: str) -> str:
    encoding = (
        speech.RecognitionConfig.AudioEncoding.OGG_OPUS
        if content_type == "audio/ogg"
        else speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
    )
    response = speech_client.recognize(
        config=speech.RecognitionConfig(
            encoding=encoding,
            sample_rate_hertz=48000,
            language_code=language_code,
            enable_automatic_punctuation=True,
        ),
        audio=speech.RecognitionAudio(content=audio_bytes),
    )
    return " ".join(result.alternatives[0].transcript for result in response.results)


def synthesize_audio(text: str, language_code: str, voice_name: str) -> StreamingResponse:
    response = tts_client.synthesize_speech(
        input=texttospeech.SynthesisInput(text=text),
        voice=texttospeech.VoiceSelectionParams(
            language_code=language_code,
            ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,
            name=voice_name,
        ),
        audio_config=texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3),
    )
    return StreamingResponse(BytesIO(response.audio_content), media_type="audio/mpeg")


@api_router.post("/googlecloudstt")
async def google_cloud_stt(
    audio: UploadFile = File(...), language_code: str = Form(...)
) -> dict[str, str]:
    return {
        "transcript": transcribe_audio(await audio.read(), audio.content_type, language_code)
    }


@api_router.post("/googlecloudtts")
async def google_cloud_tts(payload: TextToSpeechRequest) -> StreamingResponse:
    return synthesize_audio(payload.text, payload.language_code, payload.voice_name)


@api_router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router)
app.mount("/", StaticFiles(directory=PROJECT_ROOT / "frontend", html=True), name="site")
