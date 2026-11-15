import type { AudioRuntime } from '../../audio/AudioRuntime.js';

/** Scratchable audio deck with signed speed, cached reverse audio and click-resistant scrubbing. */
export class TurntableDeck {
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private buffer?: AudioBuffer;
  private reversedBuffer?: AudioBuffer;
  private startedAt = 0;
  private offset = 0;
  private speed = 1;
  private playing = false;
  private outputNode: AudioNode | undefined;

  constructor(private readonly runtime: AudioRuntime) {}

  load(buffer: AudioBuffer): void {
    this.stop();
    this.buffer = buffer;
    this.reversedBuffer = undefined;
    this.offset = 0;
  }

  get isLoaded(): boolean { return !!this.buffer; }
  get isPlaying(): boolean { return this.playing; }
  get playbackSpeed(): number { return this.speed; }
  get duration(): number { return this.buffer?.duration ?? 0; }

  /** Route deck audio into a track bus (or another AudioNode) instead of the master output. */
  connectOutput(destination: AudioNode): void {
    this.outputNode = destination;
    if (this.gain) {
      this.gain.disconnect();
      this.gain.connect(destination);
    }
  }

  play(offset = this.offset): void {
    if (!this.buffer) throw new Error('Load a sample before playing the turntable.');
    this.offset = this.clampPosition(offset);
    if (Math.abs(this.speed) < 0.015) {
      this.playing = false;
      return;
    }
    this.startAt(this.offset, false);
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    const next = Math.max(-3, Math.min(3, speed));
    if (this.playing) this.offset = this.currentPosition();
    this.speed = next;
    if (this.playing) {
      if (Math.abs(next) < 0.015) this.pauseAtPosition();
      else this.startAt(this.offset, true);
    }
  }

  /** Scrub to a position; a short gain crossfade avoids clicks between buffer slices. */
  scratch(positionSeconds: number): void {
    if (!this.buffer || !Number.isFinite(positionSeconds)) return;
    this.offset = this.clampPosition(positionSeconds);
    if (this.playing) this.startAt(this.offset, true);
  }

  currentPosition(): number {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    const elapsed = Math.max(0, this.runtime.prepareContext().currentTime - this.startedAt);
    return this.clampPosition(this.offset + elapsed * this.speed);
  }

  stop(): void {
    try { this.source?.stop(); } catch { /* Already stopped. */ }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.source = undefined;
    this.gain = undefined;
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    this.buffer = undefined;
    this.reversedBuffer = undefined;
  }

  private clampPosition(position: number): number {
    return Math.max(0, Math.min(Math.max(0, (this.buffer?.duration ?? 0) - 0.01), position));
  }

  private pauseAtPosition(): void {
    const context = this.runtime.prepareContext();
    const oldSource = this.source;
    const oldGain = this.gain;
    if (oldSource && oldGain) {
      const now = context.currentTime;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setTargetAtTime(0, now, 0.004);
      try { oldSource.stop(now + 0.025); } catch { /* Already stopped. */ }
      oldSource.onended = () => { oldSource.disconnect(); oldGain.disconnect(); };
    }
    this.source = undefined;
    this.gain = undefined;
    this.playing = false;
  }

  private startAt(position: number, crossfade: boolean): void {
    if (!this.buffer) return;
    const context = this.runtime.prepareContext();
    const now = context.currentTime;
    const oldSource = this.source;
    const oldGain = this.gain;
    if (oldSource && oldGain) {
      if (crossfade) {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.012);
        try { oldSource.stop(now + 0.016); } catch { /* Already stopped. */ }
        oldSource.onended = () => { oldSource.disconnect(); oldGain.disconnect(); };
      } else {
        try { oldSource.stop(); } catch { /* Already stopped. */ }
        oldSource.disconnect();
        oldGain.disconnect();
      }
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    const reverse = this.speed < 0;
    source.buffer = reverse ? this.getReversedBuffer(context) : this.buffer;
    source.playbackRate.setValueAtTime(Math.max(0.015, Math.abs(this.speed)), now);
    source.connect(gain);
    gain.connect(this.outputNode ?? context.destination);
    const safePosition = this.clampPosition(position);
    const sourceOffset = reverse ? Math.max(0, this.buffer.duration - safePosition - 0.01) : safePosition;
    const startAt = now + (crossfade ? 0.006 : 0);
    gain.gain.setValueAtTime(crossfade ? 0.0001 : 0.9, now);
    if (crossfade) gain.gain.linearRampToValueAtTime(0.9, startAt + 0.014);
    source.start(startAt, sourceOffset);
    this.source = source;
    this.gain = gain;
    this.offset = safePosition;
    this.startedAt = startAt;
    this.playing = true;
    source.onended = () => {
      if (this.source !== source) return;
      // BufferSource completion is the authoritative end-of-media signal. Keep
      // the platter position at the corresponding end instead of snapping back
      // to the last manually selected offset.
      this.offset = this.speed < 0 ? 0 : this.clampPosition(this.buffer?.duration ?? 0);
      this.playing = false;
      this.source = undefined;
      this.gain = undefined;
      gain.disconnect();
    };
  }

  private getReversedBuffer(context: AudioContext): AudioBuffer {
    if (this.reversedBuffer) return this.reversedBuffer;
    if (!this.buffer) throw new Error('Load a sample before reversing the turntable.');
    const reversed = context.createBuffer(this.buffer.numberOfChannels, this.buffer.length, this.buffer.sampleRate);
    for (let channel = 0; channel < this.buffer.numberOfChannels; channel++) {
      const input = this.buffer.getChannelData(channel);
      const output = reversed.getChannelData(channel);
      for (let index = 0; index < input.length; index++) output[index] = input[input.length - index - 1]!;
    }
    this.reversedBuffer = reversed;
    return reversed;
  }
}
