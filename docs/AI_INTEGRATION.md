# AI Integration

## What runs where

AI is an asynchronous asset-production subsystem. It never participates in the real-time audio path. The browser submits a generation job to a configured service, polls for progress, validates and downloads the resulting audio, then stores the bytes locally in IndexedDB. Ordinary sampler tracks play the result.

The browser must not contain hosted-provider API keys. The service URL is stored in browser local storage for convenience; it is not written into project files. A service may run locally, on a LAN machine, or behind an authenticated same-origin proxy. Configure CORS on remote services to allow the Vibe-Wizard origin.

## First integrated workflow: prompt to sampler

1. Open **AI Sound Generation** in the workbench.
2. Enter the base URL of a compatible audio-generation service. The client appends `/audio/generations`.
3. Describe the sound and choose a duration from 1 to 60 seconds.
4. Generate. Vibe-Wizard submits a job, polls status, and downloads the finished audio.
5. The downloaded file is checked for an audio MIME type, non-empty content, and a 25 MB size limit.
6. The sample and its provenance (prompt, provider adapter ID, job ID, and creation time) are saved to the local audio-asset database.
7. A new Sampler track is created and loaded. The generated file is chromatically played with MIDI note 60 as its root.

The sample is not embedded in the project JSON. The project stores a stable asset ID and filename; audio bytes and provenance live in the separate IndexedDB database `vibe-wizard-audio-assets`. Clearing browser site data removes local sample assets.

## HTTP job contract

The configurable service implements this provider-neutral contract. It is a proxy boundary: the service owns vendor authentication, provider-specific request formats, job lifecycle, and returning a downloadable audio file.

### Submit

`POST {baseUrl}/audio/generations`

Request:

```json
{
  "prompt": "A warm evolving analog bass, soft attack, subtle tape saturation",
  "durationSeconds": 6,
  "outputFormat": "wav"
}
```

Return HTTP 200 or 202 with:

```json
{ "jobId": "job_123" }
```

An `id` field is accepted as an alias for `jobId`.

### Poll

`GET {baseUrl}/audio/generations/{jobId}`

Queued/running response:

```json
{
  "status": "running",
  "progress": 42,
  "message": "Rendering audio"
}
```

`progress` is optional and ranges from 0 to 100. The status can be `queued` or `running`.

Completed response:

```json
{
  "status": "succeeded",
  "result": {
    "downloadUrl": "/audio/generations/job_123/result",
    "fileName": "analog-bass.wav",
    "mimeType": "audio/wav"
  }
}
```

The download URL may be absolute or relative to the service base URL. It must be an HTTP(S) URL and return an `audio/*` or `application/octet-stream` response. The client also accepts `failed` or `cancelled` status, using the optional `message` for the error shown to the user.

The browser polls every 1.5 seconds for up to 10 minutes. It sends no provider credentials and uses `credentials: omit`. Downloads are limited to 25 MB. The backend must enable CORS for the app origin if it is hosted separately.

## Provider abstraction

`AudioGenerationProvider` is the domain contract. `HttpAudioGenerationProvider` is the first adapter, implementing the job protocol above. Future adapters can target a self-hosted model, ComfyUI workflow, or hosted provider through a server-side bridge without changing the DAW or audio runtime.

Capability discovery should describe what a provider genuinely supports. A generated sound effect is not automatically a multi-zone pitched instrument. Do not claim velocity layers, accurate pitch coverage, or editable instrument mappings unless the provider supplies them and the import pipeline validates them.

## Next AI milestones

- Audio-to-audio transformation of a selected local sample.
- Text-assisted synth patch design that outputs validated parameter presets.
- Instrument package generation with key/velocity zones, loop points, envelopes, filters, tuning, and preview.
- Sound library search/tagging and provenance-aware reuse.
- Composition and arrangement assistance using the existing project model, with explicit user approval before applying edits.

## Security and operational limits

Never ship hosted-provider secrets in the browser bundle or project document. Keep credentials and provider-specific request logic in the configured service. Validate content type and size before storing generated files. The browser-side client currently does not transcode audio or normalize loudness; those are service-side or future import-pipeline responsibilities.
