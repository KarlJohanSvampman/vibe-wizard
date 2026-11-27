from __future__ import annotations

import io
import logging
import os
import time
import zipfile
import uuid
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Response, UploadFile
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
    model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_text_to_sound_v3")
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




class TransformAudioRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    prompt: str = Field(min_length=1, max_length=4000)
    duration_seconds: float = Field(alias="durationSeconds", ge=3, le=30)
    reference_start_ms: int = Field(alias="referenceStartMs", ge=0)
    reference_end_ms: int = Field(alias="referenceEndMs", ge=50, le=600000)
    condition_strength: str = Field(default="high", alias="conditionStrength")

    @field_validator("prompt")
    @classmethod
    def transform_prompt_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Transformation prompt must not be blank.")
        return cleaned

    @field_validator("condition_strength")
    @classmethod
    def validate_condition_strength(cls, value: str) -> str:
        if value not in {"low", "medium", "high", "xhigh"}:
            raise ValueError("Condition strength must be low, medium, high, or xhigh.")
        return value

    @field_validator("reference_end_ms")
    @classmethod
    def validate_reference_range(cls, value: int, info: Any) -> int:
        start = info.data.get("reference_start_ms", 0)
        if value - start < 50 or value - start > 30000:
            raise ValueError("The selected reference region must be between 50 ms and 30 seconds.")
        return value


def _extract_composed_audio(response: httpx.Response) -> tuple[bytes, str]:
    """Extract audio from ElevenLabs' multipart music response (or a raw audio response)."""
    content_type = response.headers.get("content-type", "audio/mpeg").split(";", 1)[0].strip().lower()
    if content_type.startswith("audio/"):
        return response.content, content_type
    header = response.headers.get("content-type", "")
    if not header.lower().startswith("multipart/"):
        raise RuntimeError("ElevenLabs Music returned an unexpected response content type.")

    from email.parser import BytesParser
    from email.policy import default as email_policy

    mime_message = BytesParser(policy=email_policy).parsebytes(
        b"MIME-Version: 1.0\r\nContent-Type: " + header.encode("ascii", "replace")
        + b"\r\n\r\n" + response.content
    )
    for part in mime_message.walk():
        part_type = (part.get_content_type() or "").lower()
        if part_type.startswith("audio/") or part_type == "application/octet-stream":
            payload = part.get_payload(decode=True)
            if payload:
                detected_type = part_type if part_type.startswith("audio/") else "audio/mpeg"
                return payload, detected_type
    raise RuntimeError("ElevenLabs Music response did not contain an audio part.")


async def call_elevenlabs_transform(
    request: TransformAudioRequest,
    source_data: bytes,
    file_name: str,
    mime_type: str,
) -> tuple[bytes, str]:
    """Use Eleven Music audio upload + conditioning to create a prompted variation."""
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured on the AI gateway.")
    if not source_data or len(source_data) > MAX_AUDIO_BYTES:
        raise RuntimeError("Source audio must be non-empty and no larger than 25 MB.")
    if not mime_type.startswith("audio/"):
        raise RuntimeError("The source file must be an audio file.")

    safe_name = Path(file_name).name[:120] or "source-audio"
    async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=20)) as client:
        upload = await client.post(
            "https://api.elevenlabs.io/v1/music/upload",
            headers={"xi-api-key": api_key},
            files={"file": (safe_name, source_data, mime_type)},
        )
        if upload.status_code in {401, 403}:
            raise RuntimeError("ElevenLabs authentication failed. Check ELEVENLABS_API_KEY and Music API access.")
        if upload.status_code == 429:
            raise RuntimeError("ElevenLabs rate limit or account concurrency limit reached.")
        if upload.status_code >= 400:
            raise RuntimeError(f"ElevenLabs music upload failed (HTTP {upload.status_code}): {upload.text[:300]}")
        try:
            song_id = upload.json().get("song_id")
        except (ValueError, AttributeError):
            song_id = None
        if not isinstance(song_id, str) or not song_id:
            raise RuntimeError("ElevenLabs music upload did not return a song_id.")

        duration_ms = max(3000, int(request.duration_seconds * 1000))
        composition_plan = {
            "chunks": [{
                "text": "[Instrumental]\n" + request.prompt,
                "duration_ms": duration_ms,
                "positive_styles": [],
                "negative_styles": [],
                "context_adherence": "high",
                "conditioning_ref": {
                    "song_id": song_id,
                    "range": {
                        "start_ms": request.reference_start_ms,
                        "end_ms": request.reference_end_ms,
                    },
                },
                "condition_strength": request.condition_strength,
            }],
        }
        composed = await client.post(
            "https://api.elevenlabs.io/v1/music",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            json={
                "composition_plan": composition_plan,
                "model_id": "music_v2_5",
                "store_for_inpainting": False,
            },
        )
        if composed.status_code in {401, 403}:
            raise RuntimeError("ElevenLabs Music API access was denied. Check your paid-plan API access.")
        if composed.status_code == 429:
            raise RuntimeError("ElevenLabs Music rate limit or account concurrency limit reached.")
        if composed.status_code >= 400:
            raise RuntimeError(f"ElevenLabs Music transformation failed (HTTP {composed.status_code}): {composed.text[:300]}")
        data, output_mime = _extract_composed_audio(composed)

    if not data:
        raise RuntimeError("ElevenLabs Music returned an empty transformed sample.")
    if len(data) > MAX_AUDIO_BYTES:
        raise RuntimeError("Transformed audio exceeds the 25 MB gateway limit.")
    return data, output_mime


class StemSeparationRequest(BaseModel):
    variation: str = Field(default="six_stems_v1")

    @field_validator("variation")
    @classmethod
    def validate_variation(cls, value: str) -> str:
        if value not in {"two_stems_v1", "six_stems_v1"}:
            raise ValueError("Stem variation must be two_stems_v1 or six_stems_v1.")
        return value


async def call_elevenlabs_stem_separation(source_data: bytes, file_name: str, mime_type: str, variation: str) -> list[dict[str, Any]]:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured on the AI gateway.")
    safe_name = Path(file_name).name[:120] or "source-audio"
    async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=20)) as client:
        response = await client.post(
            "https://api.elevenlabs.io/v1/music/stem-separation",
            params={"output_format": os.getenv("ELEVENLABS_STEM_OUTPUT_FORMAT", "mp3_44100_128")},
            headers={"xi-api-key": api_key, "Accept": "application/zip"},
            data={"stem_variation_id": variation, "sign_with_c2pa": "false"},
            files={"file": (safe_name, source_data, mime_type)},
        )
    if response.status_code in {401, 403}:
        raise RuntimeError("ElevenLabs authentication failed. Check API key and Music API access.")
    if response.status_code == 429:
        raise RuntimeError("ElevenLabs rate limit or account concurrency limit reached.")
    if response.status_code >= 400:
        raise RuntimeError(f"ElevenLabs stem separation failed (HTTP {response.status_code}): {response.text[:300]}")
    if len(response.content) > MAX_AUDIO_BYTES * 6:
        raise RuntimeError("Separated stems exceed the gateway's combined size limit.")
    if not zipfile.is_zipfile(io.BytesIO(response.content)):
        raise RuntimeError("ElevenLabs returned a response that was not a valid ZIP archive.")
    stems: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            for item in archive.infolist():
                if item.is_dir() or item.file_size <= 0:
                    continue
                name = Path(item.filename).name
                if not name or name.startswith(".") or item.file_size > MAX_AUDIO_BYTES:
                    continue
                ext = Path(name).suffix.lower()
                mime = "audio/mpeg" if ext == ".mp3" else "audio/wav" if ext in {".wav", ".wave"} else "audio/ogg" if ext == ".ogg" else "application/octet-stream"
                if not mime.startswith("audio/"):
                    continue
                data = archive.read(item)
                if data:
                    stems.append({"id": uuid.uuid4().hex, "name": name[:120], "mimeType": mime, "data": data})
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise RuntimeError("Could not safely extract the stem archive.") from error
    if not stems:
        raise RuntimeError("The stem archive contained no supported audio files.")
    return stems


async def _run_stem_separation(job_id: str, source_data: bytes, file_name: str, mime_type: str, variation: str) -> None:
    job = JOBS.get(job_id)
    if not job:
        return
    job.update(status="running", progress=5, message="Separating audio into stems with ElevenLabs")
    try:
        stems = await call_elevenlabs_stem_separation(source_data, file_name, mime_type, variation)
        job.update(status="succeeded", progress=100, message=f"Separated into {len(stems)} stems", stems=stems)
    except Exception as error:
        logger.warning("Stem separation job %s failed: %s", job_id, error)
        job.update(status="failed", progress=0, message=str(error)[:400] or "Stem separation failed.")


async def _run_generation(job_id: str, request: GenerateAudioRequest) -> None:
    job = JOBS.get(job_id)
    if not job:
        return
    job.update(status="running", progress=10, message="Generating audio with ElevenLabs SFX v3")

    try:
        data, mime_type = await call_elevenlabs(request)
        job.update(
            status="succeeded",
            progress=100,
            message="Audio generated",
            data=data,
            mimeType=mime_type,
            fileName=f"vibe-wizard-{job_id}." + ("mp3" if mime_type in {"audio/mpeg", "audio/mp3"} else "wav" if mime_type in {"audio/wav", "audio/x-wav"} else "audio"),
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


@app.post("/api/audio/transformations", status_code=202)
async def create_transformation(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    prompt: str = Form(..., min_length=1, max_length=4000),
    duration_seconds: float = Form(..., alias="durationSeconds", ge=3, le=30),
    reference_start_ms: int = Form(..., alias="referenceStartMs", ge=0),
    reference_end_ms: int = Form(..., alias="referenceEndMs", ge=50, le=600000),
    condition_strength: str = Form("high", alias="conditionStrength"),
) -> dict[str, str]:
    if not os.getenv("ELEVENLABS_API_KEY", "").strip():
        raise HTTPException(
            status_code=503,
            detail="Set ELEVENLABS_API_KEY in the server environment before transforming audio.",
        )
    if not (file.content_type or "").lower().startswith("audio/"):
        raise HTTPException(status_code=415, detail="Upload an audio file to transform.")
    try:
        request = TransformAudioRequest(
            prompt=prompt,
            durationSeconds=duration_seconds,
            referenceStartMs=reference_start_ms,
            referenceEndMs=reference_end_ms,
            conditionStrength=condition_strength,
        )
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    source_data = await file.read(MAX_AUDIO_BYTES + 1)
    if not source_data:
        raise HTTPException(status_code=422, detail="The source audio file is empty.")
    if len(source_data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Source audio exceeds the 25 MB gateway limit.")

    _prune_jobs()
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "jobId": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Waiting for the audio transformation service",
        "createdAtEpoch": time.time(),
    }
    background_tasks.add_task(
        _run_transformation,
        job_id,
        request,
        source_data,
        Path(file.filename or "source-audio").name,
        (file.content_type or "audio/mpeg").split(";", 1)[0].lower(),
    )
    return {"jobId": job_id}


async def _run_transformation(
    job_id: str,
    request: TransformAudioRequest,
    source_data: bytes,
    file_name: str,
    mime_type: str,
) -> None:
    job = JOBS.get(job_id)
    if not job:
        return
    job.update(status="running", progress=5, message="Uploading source audio to Eleven Music")
    try:
        job.update(progress=25, message="Conditioning a new variation on the selected sample")
        data, output_mime = await call_elevenlabs_transform(request, source_data, file_name, mime_type)
        job.update(
            status="succeeded",
            progress=100,
            message="Audio transformation complete",
            data=data,
            mimeType=output_mime,
            fileName=f"vibe-wizard-transform-{job_id}.mp3" if output_mime in {"audio/mpeg", "audio/mp3"} else f"vibe-wizard-transform-{job_id}.wav",
        )
    except Exception as error:
        logger.warning("Audio transformation job %s failed: %s", job_id, error)
        job.update(status="failed", progress=0, message=str(error)[:400] or "Audio transformation failed.")


@app.post("/api/audio/stem-separations", status_code=202)
async def create_stem_separation(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    variation: str = Form("six_stems_v1"),
) -> dict[str, str]:
    if not os.getenv("ELEVENLABS_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="Set ELEVENLABS_API_KEY in the server environment before separating stems.")
    if not (file.content_type or "").lower().startswith("audio/"):
        raise HTTPException(status_code=415, detail="Upload an audio file for stem separation.")
    try:
        request = StemSeparationRequest(variation=variation)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    source_data = await file.read(MAX_AUDIO_BYTES + 1)
    if not source_data:
        raise HTTPException(status_code=422, detail="The source audio file is empty.")
    if len(source_data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Source audio exceeds the 25 MB gateway limit.")
    _prune_jobs()
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"jobId": job_id, "status": "queued", "progress": 0, "message": "Waiting for stem separation", "createdAtEpoch": time.time()}
    background_tasks.add_task(_run_stem_separation, job_id, source_data, Path(file.filename or "source-audio").name, (file.content_type or "audio/mpeg").split(";", 1)[0].lower(), request.variation)
    return {"jobId": job_id}


@app.get("/api/audio/stem-separations/{job_id}")
async def get_stem_separation(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Stem separation job not found or expired.")
    result = None
    if job["status"] == "succeeded":
        result = {"stems": [{"id": stem["id"], "name": stem["name"], "mimeType": stem["mimeType"], "downloadUrl": f"/api/audio/stem-separations/{job_id}/stems/{stem['id']}"} for stem in job["stems"]]}
    return {"jobId": job_id, "status": job["status"], "progress": job["progress"], "message": job["message"], **({"result": result} if result else {})}


@app.get("/api/audio/stem-separations/{job_id}/stems/{stem_id}")
async def download_separated_stem(job_id: str, stem_id: str) -> Response:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Stem separation job not found or expired.")
    if job["status"] != "succeeded":
        raise HTTPException(status_code=409, detail="Separated stems are not ready.")
    stem = next((item for item in job["stems"] if item["id"] == stem_id), None)
    if not stem:
        raise HTTPException(status_code=404, detail="Stem not found.")
    return Response(content=stem["data"], media_type=stem["mimeType"], headers={"Content-Disposition": f'attachment; filename="{stem["name"]}"', "Cache-Control": "no-store"})


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
