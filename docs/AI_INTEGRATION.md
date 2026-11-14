# AI Integration

## Boundaries

AI is an asynchronous asset-production subsystem. It must not participate in the real-time audio path. A generated asset is validated, imported into local storage, and then used by ordinary instruments.

## Provider abstraction

Define provider interfaces rather than tying the app to one vendor. Conceptual contracts:
- Sample generation from prompt/category/duration and optional references.
- Audio-to-audio transformation of an existing sample.
- Instrument package design returning zones, samples, mappings, loop points, envelope settings, and metadata.

Provider capability discovery is important: some services generate full music clips or sound effects but do not provide accurately pitched multisample sets or editable instrument zones. Do not imply unsupported precision.

## Sample asset pipeline

1. User prompt and options.
2. Provider job submission.
3. Progress/status polling or callback.
4. Fetch generated audio.
5. Validate MIME type, duration, sample rate, channel count, and size.
6. Decode/preview.
7. Store in IndexedDB with metadata and provenance.
8. Import into sampler or project.

## Instrument package

A playable instrument needs more than one audio file. Package may include:
- audio samples
- root key and key/velocity ranges
- loop start/end and loop mode
- envelopes and filters
- pitch mapping and tuning
- metadata and preview
- optional synthesis instructions

Validate coverage gaps and warn when a proposed instrument is a single-sample approximation.

## Security

Never ship hosted provider secrets in client bundles. Use an optional thin proxy/backend for secret-bearing API calls. Local inference adapters may call a user-configured service endpoint. Persist provider configuration without secrets in project files.

## Product milestones

AI sample generation and transformation should follow the core rack/sequencer prototype. Instrument generation comes later because mapping samples into a musically playable instrument requires validation and zone editing.
