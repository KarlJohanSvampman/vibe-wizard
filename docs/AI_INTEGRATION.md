# AI Integration

## First AI workflow: prompt to playable sample

The first concrete integration uses **ElevenLabs text-to-sound generation** through a local FastAPI gateway. ElevenLabs accepts a natural-language sound description and returns generated audio. Its Sound Effects API also documents musical components such as drum loops, bass lines, vintage brass stabs, and synth pads. The API currently supports generation durations up to 30 seconds and returns MP3 by default. See the [official Sound Effects API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) and [capability guide](https://elevenlabs.io/docs/overview/capabilities/sound-effects).

Workflow:

1. Start the local Python gateway with a server-side `ELEVENLABS_API_KEY`.
2. Open the **AI Sound Generation** panel in Vibe-Wizard. Its default service URL is `http://localhost:8787/api`.
3. Describe the sound and choose a duration from 1 to 30 seconds.
4. Vibe-Wizard submits an asynchronous job, polls progress, and downloads the generated audio.
5. The browser validates the audio MIME type, non-empty content, and 25 MB size limit.
6. The audio and provenance (prompt, provider adapter, job ID, and creation time) are written to the local IndexedDB asset store.
7. A new Sampler track is created and loaded. The sample plays chromatically with MIDI note 60 as its root.

The generation workflow is deliberately outside the real-time audio graph. Provider latency or failure cannot interrupt playback of existing tracks.

## Run the included local gateway

Requirements: Python 3.11+.

```bash
python -m venv .venv
# Windows PowerShell:
.venv\\Scripts\\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
pip install -r server/requirements.txt
```

Copy `.env.example` to `.env` and set `ELEVENLABS_API_KEY`. The gateway loads this file on startup. The API key is used only by the Python process; it is never placed in a Vite variable, project snapshot, or browser request.

```bash
python -m uvicorn server.ai_gateway:app --reload --host 127.0.0.1 --port 8787
```

Run Vibe-Wizard separately with `npm run dev`. The current Vite development server uses port 8081, which is included in the gateway's default CORS allow-list. The gateway binds to localhost by default and keeps job results in memory for up to 30 minutes. It is intended for a single local process; use a durable queue and authenticated reverse proxy before deploying it to a shared or public network.

Environment variables:

- `ELEVENLABS_API_KEY` — required server-side secret.
- `ELEVENLABS_MODEL_ID` — defaults to `eleven_text_to_sound_v2`.
- `ELEVENLABS_OUTPUT_FORMAT` — defaults to `mp3_44100_128`.
- `ELEVENLABS_PROMPT_INFLUENCE` — defaults to `0.35`, valid range 0..1.
- `CORS_ORIGINS` — comma-separated browser origins; default includes localhost port 8081.

The gateway uses an in-memory job queue with a 20-job cap, 30-minute retention, and 25 MB result cap. Run one worker process. It handles provider authentication, provider request formatting, and transient job state. A later production version should move jobs/assets to durable storage and add user authentication, rate limiting, per-user quotas, and cancellation.

## Browser/provider architecture

The browser depends only on the `AudioGenerationProvider` interface. `HttpAudioGenerationProvider` speaks a provider-neutral job protocol. The FastAPI gateway currently adapts that protocol to ElevenLabs, but a future gateway can use a self-hosted model, ComfyUI, another hosted provider, or an internal inference service without changing the DAW.

### Submit

`POST {baseUrl}/audio/generations`

```json
{
  "prompt": "A warm evolving analog bass, soft attack, subtle tape saturation",
  "durationSeconds": 6,
  "outputFormat": "mp3"
}
```

Return HTTP 202 with:

```json
{ "jobId": "job_123" }
```

### Poll

`GET {baseUrl}/audio/generations/{jobId}`

Queued/running:

```json
{
  "status": "running",
  "progress": 10,
  "message": "Generating audio with ElevenLabs"
}
```

Completed:

```json
{
  "status": "succeeded",
  "result": {
    "downloadUrl": "/api/audio/generations/job_123/result",
    "fileName": "vibe-wizard-job_123.mp3",
    "mimeType": "audio/mpeg"
  }
}
```

Failed jobs return `status: "failed"` and a user-readable `message`. The browser polls every 1.5 seconds for up to 10 minutes. It sends no provider credentials and uses `credentials: omit`.

## Sample storage and provenance

Generated sample bytes live in the separate IndexedDB database `vibe-wizard-audio-assets`, not in project JSON. The project stores a stable asset ID and filename. Each generated sample also stores its prompt, provider ID, job ID, and creation time so it can later be searched, regenerated, or transformed. Clearing browser site data removes local sample assets.

## Security boundaries

Never ship hosted-provider secrets in the browser bundle or project document. The included gateway defaults to binding on `127.0.0.1`; do not expose it to the public internet as-is. CORS is not authentication. For LAN or hosted use, place it behind authentication and rate limiting, and keep secrets in the server environment. Avoid putting secrets in `VITE_*` variables because those are bundled into browser code.

## Next AI milestones

- Audio-to-audio transformation of a selected local sample.
- Text-assisted synth patch design that outputs validated parameter presets.
- Instrument package generation with key/velocity zones, loop points, envelopes, filters, tuning, and preview.
- Sound library search/tagging and provenance-aware reuse.
- Composition and arrangement assistance using the existing project model, with explicit user approval before applying edits.
