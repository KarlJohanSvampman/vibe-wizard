from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

logger = logging.getLogger("vibe_wizard.ai_gateway")
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_JOBS = 20
JOB_TTL_SECONDS = 30 * 60

# This in-memory queue is intended for a single local development process.
# Replace it with Redis/a durable queue before running multiple worker processes.
JOBS: dict[str, dict[str, Any]] = {}


class GenerateAudioRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    prompt: str = Field(min_length=1, max_length=4000)
    duration_seconds: float = Field(alias="durationSeconds", ge=1, le=30)

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Prompt must not be blank.")
        return cleaned


def _prune_jobs() -> None:
    now = time.time()
    expired = [
        job_id for job_id, job in JOBS.items()
        if job["status"] in {"succeeded", "failed"}
        and now - job["createdAtEpoch"] > JOB_TTL_SECONDS
    ]
    for job_id in expired:
        JOBS.pop(job_id, None)

    while len(JOBS) >= MAX_JOBS:
        completed = [
            (job["createdAtEpoch"], job_id)
            for job_id, job in JOBS.items()
            if job["status"] in {"succeeded", "failed"}
        ]
        if not completed:
            raise HTTPException(status_code=429, detail="AI generation queue is full.")
        _, oldest_id = min(completed)
        JOBS.pop(oldest_id, None)


async def call_elevenlabs(request: GenerateAudioRequest) -> tuple[bytes, str]:
    """Call the ElevenLabs text-to-sound endpoint without exposing its key to the browser."""
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured on the AI gateway.")

    output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128")
    model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_text_to_sound_v2")
    try:
        prompt_influence = float(os.getenv("ELEVENLABS_PROMPT_INFLUENCE", "0.35"))
    except ValueError as error:
        raise RuntimeError("ELEVENLABS_PROMPT_INFLUENCE must be a number from 0 to 1.") from error
    if not 0 <= prompt_influence <= 1:
        raise RuntimeError("ELEVENLABS_PROMPT_INFLUENCE must be between 0 and 1.")

    async with httpx.AsyncClient(timeout=httpx.Timeout(150, connect=15)) as client:
        response = await client.post(
            "https://api.elevenlabs.io/v1/sound-generation",
            params={"output_format": output_format},
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            json={
                "text": request.prompt,
                "duration_seconds": request.duration_seconds,
                "prompt_influence": prompt_influence,
                "model_id": model_id,
                "loop": False,
            },
        )

    if response.status_code in {401, 403}:
        raise RuntimeError("ElevenLabs authentication failed. Check ELEVENLABS_API_KEY.")
    if response.status_code == 429:
        raise RuntimeError("ElevenLabs rate limit or account concurrency limit reached.")
    if response.status_code >= 400:
        detail = response.text[:400]
        raise RuntimeError(f"ElevenLabs returned HTTP {response.status_code}: {detail}")

    data = response.content
    if not data:
        raise RuntimeError("ElevenLabs returned an empty audio file.")
    if len(data) > MAX_AUDIO_BYTES:
        raise RuntimeError("Generated audio exceeds the 25 MB gateway limit.")

    mime_type = response.headers.get("content-type", "audio/mpeg").split(";", 1)[0].strip().lower()
    if not mime_type.startswith("audio/"):
        mime_type = "audio/mpeg" if output_format.startswith("mp3") else mime_type
    if not mime_type.startswith("audio/"):
        raise RuntimeError("ElevenLabs returned a response that was not identified as audio.")
    return data, mime_type


async def _run_generation(job_id: str, request: GenerateAudioRequest) -> None:
    job = JOBS.get(job_id)
    if not job:
        return
    job.update(status="running", progress=10, message="Generating audio with ElevenLabs")

    try:
        data, mime_type = await call_elevenlabs(request)
        job.update(
            status="succeeded",
            progress=100,
            message="Audio generated",
            data=data,
            mimeType=mime_type,
            fileName=f"vibe-wizard-{job_id}.mp3",
        )
    except Exception as error:  # Keep the job pollable and avoid leaking secrets in tracebacks to clients.
        logger.warning("Audio generation job %s failed: %s", job_id, error)
        job.update(
            status="failed",
            progress=0,
            message=str(error)[:400] or "Audio generation failed.",
        )


app = FastAPI(
    title="Vibe-Wizard AI Audio Gateway",
    description="Local server-side bridge from Vibe-Wizard to an audio-generation provider.",
    version="0.1.0",
)

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "provider": "elevenlabs"}


@app.post("/api/audio/generations", status_code=202)
async def create_generation(
    request: GenerateAudioRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    if not os.getenv("ELEVENLABS_API_KEY", "").strip():
        raise HTTPException(
            status_code=503,
            detail="Set ELEVENLABS_API_KEY in the server environment before generating audio.",
        )

    _prune_jobs()
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "jobId": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Waiting for the audio generator",
        "createdAtEpoch": time.time(),
    }
    background_tasks.add_task(_run_generation, job_id, request)
    return {"jobId": job_id}


@app.get("/api/audio/generations/{job_id}")
async def get_generation(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Generation job not found or expired.")

    result = None
    if job["status"] == "succeeded":
        result = {
            "downloadUrl": f"/api/audio/generations/{job_id}/result",
            "fileName": job["fileName"],
            "mimeType": job["mimeType"],
        }
    return {
        "jobId": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        **({"result": result} if result else {}),
    }


@app.get("/api/audio/generations/{job_id}/result")
async def download_generation(job_id: str) -> Response:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Generation job not found or expired.")
    if job["status"] != "succeeded":
        raise HTTPException(status_code=409, detail="Generated audio is not ready.")
    return Response(
        content=job["data"],
        media_type=job["mimeType"],
        headers={
            "Content-Disposition": f'attachment; filename="{job["fileName"]}"',
            "Cache-Control": "no-store",
        },
    )
