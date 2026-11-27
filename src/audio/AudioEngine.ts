import { clamp, midiToFrequency } from './events.js';
import type { NoteOffEvent, NoteOnEvent } from './events.js';
import type { RackModule } from '../rack/types.js';
import { AudioRuntime } from './AudioRuntime.js';
import type { InstrumentType } from './InstrumentTypes.js';
import { defaultPolyphony, selectVoiceToSteal, voiceKey } from './VoiceManagement.js';

export interface SamplerPlaybackSettings {
  readonly startPosition: number;
  readonly endPosition: number;
  readonly loopEnabled: boolean;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly rootNote: number;
  readonly playbackMode: 'one-shot' | 'gate';
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly sustainLevel: number;
  readonly releaseSeconds: number;
}

interface PitchControl {
  readonly parameter: AudioParam;
  readonly multiplier: number;
}

interface InstrumentVoice {
  readonly sources: AudioScheduledSourceNode[];
  readonly nodes: AudioNode[];
  readonly pitchControls: PitchControl[];
  readonly envelope: GainNode;
  readonly sourceId: string;
  readonly noteId: string;
  readonly velocity: number;
  readonly startTime: number;
  readonly oneShot: boolean;
  readonly samplerEnvelope?: {
    readonly attackSeconds: number;
    readonly decaySeconds: number;
    readonly sustainLevel: number;
    readonly releaseSeconds: number;
  };
  remainingSources: number;
  releaseTime?: number;
}

/**
 * Multi-voice Web Audio instrument host. Instrument families share one runtime
 * and track-output contract but construct different native Web Audio voices.
 */
export class AudioEngine implements RackModule {
  readonly kind = 'instrument' as const;

  private readonly runtime: AudioRuntime;
  private readonly ownsRuntime: boolean;
  private masterGain: GainNode | undefined;
  private outputNode: AudioNode | undefined;
  private readonly voices = new Map<string, InstrumentVoice>();
  private readonly disconnectedVoiceNodes = new WeakSet<AudioNode>();
  private masterVolume = 0.35;
  private maxPolyphony: number;
  private synthWaveform: OscillatorType = 'sawtooth';
  private synthCutoff = 12000;
  private synthResonance = 0.7;
  private sampleBuffer: AudioBuffer | undefined;
  private samplerSettings: SamplerPlaybackSettings = {
    startPosition: 0, endPosition: 1, loopEnabled: false,
    loopStart: 0, loopEnd: 1, rootNote: 60, playbackMode: 'gate',
    attackSeconds: 0.008, decaySeconds: 0.12, sustainLevel: 0.8, releaseSeconds: 0.14,
  };
  private readonly auditionNoteId = '__sampler-audition__';
  private noiseBuffer: AudioBuffer | undefined;
  private disposed = false;

  constructor(
    readonly id: string,
    runtime?: AudioRuntime,
    readonly instrumentType: InstrumentType = 'synth',
  ) {
    this.runtime = runtime ?? new AudioRuntime();
    this.ownsRuntime = runtime === undefined;
    this.maxPolyphony = defaultPolyphony(instrumentType);
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed audio engine.');
    const context = this.runtime.prepareContext();

    if (!this.masterGain) {
      this.masterGain = context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.outputNode ??= context.destination;
      this.masterGain.connect(this.outputNode);
    }

    await this.runtime.start();
  }

  get isRunning(): boolean {
    return this.runtime.isRunning;
  }

  get currentTime(): number {
    return this.runtime.currentTime;
  }

  get hasSample(): boolean {
    return this.sampleBuffer !== undefined;
  }

  performanceTimeForAudioTime(audioTime: number): number {
    return this.runtime.performanceTimeForAudioTime(audioTime);
  }

  get sampleDuration(): number { return this.sampleBuffer?.duration ?? 0; }

  get activeVoiceCount(): number { return this.voices.size; }

  /** Set the instrument voice ceiling. Values are clamped to 1..128. */
  setMaxPolyphony(value: number): void {
    if (!Number.isFinite(value)) return;
    this.maxPolyphony = clamp(Math.floor(value), 1, 128);
    while (this.voices.size > this.maxPolyphony) {
      const victim = this.selectVoiceVictim();
      if (!victim) break;
      this.stopVoiceImmediately(victim);
    }
  }

  setSynthSettings(settings: { waveform?: OscillatorType; cutoff?: number; resonance?: number }): void {
    if (this.instrumentType !== 'synth') return;
    if (settings.waveform && ['sine', 'triangle', 'sawtooth', 'square'].includes(settings.waveform)) this.synthWaveform = settings.waveform;
    if (Number.isFinite(settings.cutoff)) this.synthCutoff = clamp(settings.cutoff!, 80, 18000);
    if (Number.isFinite(settings.resonance)) this.synthResonance = clamp(settings.resonance!, 0.1, 18);
    const at = this.runtime.currentTime;
    for (const voice of this.voices.values()) {
      for (const node of voice.nodes) {
        if (node instanceof BiquadFilterNode) {
          node.frequency.setTargetAtTime(this.synthCutoff, at, 0.02);
          node.Q.setTargetAtTime(this.synthResonance, at, 0.02);
        }
      }
    }
  }

  setSamplerSettings(settings: SamplerPlaybackSettings): void {
    if (this.instrumentType !== 'sampler') return;
    const changed = Object.keys(settings).some(key =>
      settings[key as keyof SamplerPlaybackSettings] !== this.samplerSettings[key as keyof SamplerPlaybackSettings],
    );
    if (!changed) return;
    this.stopAudition();
    this.samplerSettings = { ...settings };
  }

  clearSample(): void {
    this.stopAudition();
    this.sampleBuffer = undefined;
  }

  /** Decode one user-provided sample on the shared project AudioContext. */
  async loadSample(data: ArrayBuffer): Promise<void> {
    const context = this.runtime.requireContext();
    this.clearSample();
    this.sampleBuffer = await context.decodeAudioData(data.slice(0));
  }

  /** Audition without creating a sequencer or recorder event. */
  auditionSample(pitch = this.samplerSettings.rootNote): void {
    if (this.instrumentType !== 'sampler' || !this.sampleBuffer || !this.masterGain) return;
    this.stopAudition();
    this.noteOn({
      kind: 'note-on', sourceId: this.id, noteId: this.auditionNoteId,
      pitch: clamp(pitch, 0, 127), velocity: 0.85, timestamp: performance.now() / 1000,
    });
  }

  stopAudition(): void {
    const voice = this.voices.get(voiceKey(this.id, this.auditionNoteId));
    if (!voice) return;
    this.noteOff({
      kind: 'note-off', sourceId: voice.sourceId, noteId: this.auditionNoteId,
      timestamp: performance.now() / 1000,
    }, 0.025);
  }

  /** Route this instrument's output into its owning track bus. */
  connectOutput(destination: AudioNode): void {
    this.outputNode = destination;
    if (!this.masterGain) return;
    this.masterGain.disconnect();
    this.masterGain.connect(destination);
  }

  noteOn(event: NoteOnEvent): void {
    const context = this.runtime.requireContext();
    if (!this.masterGain) throw new Error('Start the instrument before sending note events.');
    const startTime = this.runtime.toAudioTime(event.timestamp);

    const key = voiceKey(event.sourceId, event.noteId);
    if (this.voices.has(key)) this.stopVoiceImmediately(key);
    this.ensurePolyphonyCapacity();

    const pitch = clamp(event.pitch, 0, 127);
    const velocity = clamp(event.velocity, 0, 1);
    const envelope = context.createGain();
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [envelope];
    const pitchControls: PitchControl[] = [];
    const oneShot = this.instrumentType === 'drums' ||
      (this.instrumentType === 'sampler' && this.samplerSettings.playbackMode === 'one-shot' && event.noteId !== this.auditionNoteId);
    const sourceStopTimes = new Map<AudioScheduledSourceNode, number>();
    const amplitude = Math.max(0.0001, velocity);
    const synthFilter = this.instrumentType === 'synth' ? context.createBiquadFilter() : undefined;
    if (synthFilter) {
      synthFilter.type = 'lowpass';
      synthFilter.frequency.setValueAtTime(this.synthCutoff, startTime);
      synthFilter.Q.setValueAtTime(this.synthResonance, startTime);
      synthFilter.connect(envelope);
      nodes.push(synthFilter);
    }

    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.linearRampToValueAtTime(amplitude, startTime + 0.008);
    envelope.connect(this.masterGain);

    const samplerEnvelope = this.instrumentType === 'sampler' && !oneShot
      ? {
          attackSeconds: clamp(this.samplerSettings.attackSeconds, 0.001, 2),
          decaySeconds: clamp(this.samplerSettings.decaySeconds, 0.001, 5),
          sustainLevel: clamp(this.samplerSettings.sustainLevel, 0.01, 1),
          releaseSeconds: clamp(this.samplerSettings.releaseSeconds, 0.01, 5),
        }
      : undefined;
    if (samplerEnvelope) {
      envelope.gain.cancelScheduledValues(startTime);
      envelope.gain.setValueAtTime(0.0001, startTime);
      envelope.gain.linearRampToValueAtTime(amplitude, startTime + samplerEnvelope.attackSeconds);
      envelope.gain.linearRampToValueAtTime(
        amplitude * samplerEnvelope.sustainLevel,
        startTime + samplerEnvelope.attackSeconds + samplerEnvelope.decaySeconds,
      );
    }

    const addOscillator = (
      type: OscillatorType,
      harmonic: number,
      partialLevel = 1,
      detuneCents = 0,
    ): OscillatorNode => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(midiToFrequency(pitch) * harmonic, startTime);
      if (detuneCents !== 0) oscillator.detune.setValueAtTime(detuneCents, startTime);
      if (partialLevel === 1) {
        oscillator.connect(synthFilter ?? envelope);
      } else {
        const partialGain = context.createGain();
        partialGain.gain.value = partialLevel;
        oscillator.connect(partialGain);
        partialGain.connect(envelope);
        nodes.push(partialGain);
      }
      sources.push(oscillator);
      nodes.push(oscillator);
      pitchControls.push({ parameter: oscillator.frequency, multiplier: harmonic });
      return oscillator;
    };

    if (this.instrumentType === 'synth') {
      addOscillator(this.synthWaveform, 1);
    } else if (this.instrumentType === 'piano') {
      // A compact additive piano model: the fundamental dominates while
      // upper harmonics provide the bright attack of a struck string.
      [1, 2, 3, 4].forEach((harmonic, index) => {
        addOscillator('sine', harmonic, [1, 0.34, 0.15, 0.065][index]!, index === 1 ? -2 : 0);
      });
      envelope.gain.setTargetAtTime(Math.max(0.0001, amplitude * 0.17), startTime + 0.22, 0.52);
    } else if (this.instrumentType === 'drums') {
      const addNoise = (
        filterType: BiquadFilterType,
        frequency: number,
        duration: number,
      ): void => {
        const noise = context.createBufferSource();
        noise.buffer = this.getNoiseBuffer(context);
        const filter = context.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(frequency, startTime);
        filter.Q.value = filterType === 'bandpass' ? 0.85 : 0.7;
        noise.connect(filter);
        filter.connect(envelope);
        sources.push(noise);
        nodes.push(noise, filter);
        sourceStopTimes.set(noise, startTime + duration);
      };

      if (pitch === 35 || pitch === 36) {
        const kick = addOscillator('sine', 1);
        kick.frequency.setValueAtTime(155, startTime);
        kick.frequency.exponentialRampToValueAtTime(46, startTime + 0.13);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.48);
        sourceStopTimes.set(kick, startTime + 0.5);
      } else if (pitch === 38 || pitch === 40) {
        addNoise('bandpass', 1850, 0.28);
        const body = addOscillator('triangle', 1);
        body.frequency.setValueAtTime(pitch === 38 ? 185 : 160, startTime);
        body.frequency.exponentialRampToValueAtTime(80, startTime + 0.11);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.32);
        sourceStopTimes.set(body, startTime + 0.34);
      } else if ([42, 44, 46, 49, 51, 53].includes(pitch)) {
        addNoise('highpass', pitch === 46 || pitch === 49 ? 5200 : 7200, pitch === 46 ? 0.55 : 0.18);
        envelope.gain.exponentialRampToValueAtTime(
          0.0001,
          startTime + (pitch === 46 ? 0.52 : 0.2),
        );
      } else {
        const tom = addOscillator('sine', 1);
        const base = 95 + ((pitch % 12) * 8);
        tom.frequency.setValueAtTime(base * 1.8, startTime);
        tom.frequency.exponentialRampToValueAtTime(base * 0.72, startTime + 0.2);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.38);
        sourceStopTimes.set(tom, startTime + 0.4);
      }
    } else if (this.sampleBuffer) {
      const sample = context.createBufferSource();
      sample.buffer = this.sampleBuffer;
      const settings = this.samplerSettings;
      const duration = this.sampleBuffer.duration;
      const offset = clamp(settings.startPosition, 0, 0.999) * duration;
      const end = clamp(settings.endPosition, settings.startPosition + 0.001, 1) * duration;
      const rate = midiToFrequency(pitch) / midiToFrequency(settings.rootNote);
      sample.playbackRate.setValueAtTime(rate, startTime);
      if (oneShot) {
        // Fade a one-shot sample over its final few milliseconds to avoid a
        // hard discontinuity when the AudioBufferSourceNode reaches its end.
        const playbackSeconds = Math.max(0.001, (end - offset) / rate);
        const fadeSeconds = Math.min(0.012, playbackSeconds * 0.25);
        const fadeStart = startTime + Math.max(0, playbackSeconds - fadeSeconds);
        envelope.gain.setValueAtTime(amplitude, fadeStart);
        envelope.gain.linearRampToValueAtTime(0.0001, startTime + playbackSeconds);
      }
      if (settings.loopEnabled && settings.playbackMode === 'gate') {
        sample.loop = true;
        sample.loopStart = clamp(settings.loopStart, settings.startPosition, settings.endPosition) * duration;
        sample.loopEnd = clamp(settings.loopEnd, settings.loopStart + 0.001, settings.endPosition) * duration;
      }
      sample.connect(envelope);
      sources.push(sample);
      nodes.push(sample);
      pitchControls.push({ parameter: sample.playbackRate, multiplier: 1 });

    } else {
      // Keep an unloaded sampler track responsive, while the UI asks for a file.
      addOscillator('triangle', 1);
    }

    const voice: InstrumentVoice = {
      sources,
      nodes,
      pitchControls,
      envelope,
      sourceId: event.sourceId,
      noteId: event.noteId,
      velocity,
      startTime,
      oneShot,
      samplerEnvelope,
      remainingSources: sources.length,
    };
    this.voices.set(key, voice);

    for (const source of sources) {
      source.onended = () => {
        voice.remainingSources -= 1;
        if (voice.remainingSources <= 0) {
          // Disconnect the complete voice graph exactly once after its final
          // source ends. The source is included in nodes, so disconnecting it
          // both here and in this loop needlessly duplicated cleanup.
          for (const node of nodes) {
            this.disconnectVoiceNode(node);
          }
          if (this.voices.get(key) === voice) this.voices.delete(key);
        } else {
          this.disconnectVoiceNode(source);
        }
      };
      if (this.instrumentType === 'sampler' && source === sources[0]) {
        const sample = source as AudioBufferSourceNode;
        const duration = this.sampleBuffer?.duration ?? 0;
        const offset = clamp(this.samplerSettings.startPosition, 0, 0.999) * duration;
        const end = clamp(this.samplerSettings.endPosition, this.samplerSettings.startPosition + 0.001, 1) * duration;
        if (sample.loop) sample.start(startTime, offset);
        else sample.start(startTime, offset, Math.max(0.001, end - offset));
      } else source.start(startTime);
      const stopAt = sourceStopTimes.get(source);
      if (stopAt !== undefined) source.stop(stopAt);
    }

    if (sources.length === 0) {
      this.voices.delete(key);
    }
  }

  private disconnectVoiceNode(node: AudioNode): void {
    if (this.disconnectedVoiceNodes.has(node)) return;
    this.disconnectedVoiceNodes.add(node);
    try { node.disconnect(); } catch { /* already disconnected or context closed */ }
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.floor(context.sampleRate * 0.8));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  noteOff(event: NoteOffEvent, releaseSeconds?: number): void {
    const key = voiceKey(event.sourceId, event.noteId);
    const voice = this.voices.get(key);
    const context = this.runtime.context;
    if (!voice || voice.oneShot || !context || context.state === 'closed') return;

    const requestedTime = this.runtime.toAudioTime(event.timestamp);
    const releaseTime = Math.max(requestedTime, voice.startTime);
    if (voice.releaseTime !== undefined && releaseTime >= voice.releaseTime) return;

    if (requestedTime < voice.startTime) {
      voice.envelope.gain.cancelScheduledValues(voice.startTime);
      for (const source of voice.sources) {
        try { source.stop(Math.max(context.currentTime, requestedTime)); } catch { /* already stopped */ }
      }
      voice.releaseTime = requestedTime;
      return;
    }

    const release = Math.max(0.015, releaseSeconds ?? voice.samplerEnvelope?.releaseSeconds ?? 0.14);
    voice.envelope.gain.cancelScheduledValues(releaseTime);
    const samplerEnvelope = voice.samplerEnvelope;
    let releaseLevel = 1;
    if (samplerEnvelope) {
      const elapsed = Math.max(0, releaseTime - voice.startTime);
      if (elapsed < samplerEnvelope.attackSeconds) {
        releaseLevel = elapsed / samplerEnvelope.attackSeconds;
      } else if (elapsed < samplerEnvelope.attackSeconds + samplerEnvelope.decaySeconds) {
        const decayProgress = (elapsed - samplerEnvelope.attackSeconds) / samplerEnvelope.decaySeconds;
        releaseLevel = 1 - (1 - samplerEnvelope.sustainLevel) * decayProgress;
      } else {
        releaseLevel = samplerEnvelope.sustainLevel;
      }
    }
    voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.velocity * releaseLevel), releaseTime);
    voice.envelope.gain.linearRampToValueAtTime(0.0001, releaseTime + release);
    for (const source of voice.sources) {
      try { source.stop(releaseTime + release + 0.02); } catch { /* already stopped */ }
    }
    voice.releaseTime = releaseTime;
  }

  allNotesOff(): void {
    const timestamp = performance.now() / 1000;
    for (const voice of this.voices.values()) {
      this.noteOff({
        kind: 'note-off',
        sourceId: voice.sourceId,
        noteId: voice.noteId,
        timestamp,
      }, 0.03);
    }
  }

  /** Immediately silence every voice, including autonomous one-shot sounds. */
  panic(): void {
    for (const key of [...this.voices.keys()]) this.stopVoiceImmediately(key);
  }

  private selectVoiceVictim(): string | undefined {
    return selectVoiceToSteal([...this.voices.entries()].map(([key, voice]) => ({
      key,
      startTime: voice.startTime,
      releaseTime: voice.releaseTime,
    })));
  }

  private ensurePolyphonyCapacity(): void {
    if (this.voices.size < this.maxPolyphony) return;
    const victim = this.selectVoiceVictim();
    if (victim) this.stopVoiceImmediately(victim);
  }

  private stopVoiceImmediately(key: string): void {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.voices.delete(key);
    const context = this.runtime.context;
    const now = context && context.state !== 'closed' ? context.currentTime : voice.startTime;
    try {
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setValueAtTime(0.0001, now);
    } catch { /* context may already be closed */ }
    for (const source of voice.sources) {
      try { source.stop(now); } catch { /* source may already have stopped */ }
    }
    for (const node of voice.nodes) {
      this.disconnectVoiceNode(node);
    }
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (!Number.isFinite(value)) return;

    if (parameterId === 'volume') {
      this.masterVolume = clamp(value, 0, 1);
      if (this.masterGain) {
        this.masterGain.gain.setTargetAtTime(
          this.masterVolume,
          this.runtime.toAudioTime(timestamp),
          0.012,
        );
      }
      return;
    }

    if (parameterId !== 'pitch' || !this.masterGain || this.instrumentType === 'drums') return;
    const pitch = clamp(value, 0, 127);
    const at = this.runtime.toAudioTime(timestamp);
    const frequency = this.instrumentType === 'sampler'
      ? midiToFrequency(pitch) / midiToFrequency(this.samplerSettings.rootNote)
      : midiToFrequency(pitch);
    for (const voice of this.voices.values()) {
      for (const control of voice.pitchControls) {
        control.parameter.setTargetAtTime(
          frequency * control.multiplier,
          Math.max(at, voice.startTime),
          0.018,
        );
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.panic();
    this.masterGain?.disconnect();
    this.masterGain = undefined;
    this.outputNode = undefined;
    if (this.ownsRuntime) await this.runtime.dispose();
  }
}
