import type { AudioRuntime } from '../../audio/AudioRuntime.js';

/** Scratchable one-shot deck backed by an AudioBuffer. Speed is signed: negative reverses playback. */
export class TurntableDeck {
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private buffer?: AudioBuffer;
  private startedAt = 0;
  private offset = 0;
  private speed = 1;
  private playing = false;
  constructor(private readonly runtime: AudioRuntime) {}
  load(buffer: AudioBuffer): void { this.stop(); this.buffer = buffer; this.offset = 0; }
  get isLoaded(): boolean { return !!this.buffer; }
  get isPlaying(): boolean { return this.playing; }
  get playbackSpeed(): number { return this.speed; }
  get duration(): number { return this.buffer?.duration ?? 0; }
  play(offset = this.offset): void {
    if (!this.buffer) throw new Error('Load a sample before playing the turntable.');
    this.stop();
    const context = this.runtime.prepareContext();
    const gain = context.createGain(); gain.gain.value = 0.9; gain.connect(context.destination);
    const source = context.createBufferSource();
    if (this.speed < 0) {
      const reversed = context.createBuffer(this.buffer.numberOfChannels, this.buffer.length, this.buffer.sampleRate);
      for (let channel = 0; channel < this.buffer.numberOfChannels; channel++) {
        const input = this.buffer.getChannelData(channel);
        const output = reversed.getChannelData(channel);
        for (let index = 0; index < input.length; index++) output[index] = input[input.length - index - 1]!;
      }
      source.buffer = reversed;
    } else {
      source.buffer = this.buffer;
    }
    source.playbackRate.value = Math.max(0.01, Math.abs(this.speed));
    source.connect(gain);
    const safeOffset = Math.max(0, Math.min(this.buffer.duration - 0.01, offset));
    source.start(0, this.speed < 0 ? Math.max(0, this.buffer.duration - safeOffset) : safeOffset);
    this.source = source; this.gain = gain; this.startedAt = context.currentTime; this.offset = safeOffset; this.playing = true;
    source.onended = () => { if (this.source === source) { this.playing = false; this.source = undefined; this.gain?.disconnect(); this.gain = undefined; } };
  }
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    const next = Math.max(-3, Math.min(3, speed));
    const wasPlaying = this.playing;
    if (wasPlaying) this.offset = this.currentPosition();
    this.speed = next;
    if (wasPlaying) this.play(this.offset);
  }
  /** Direct platter-position control: changing it while playing restarts at that location. */
  scratch(positionSeconds: number): void {
    if (!this.buffer || !Number.isFinite(positionSeconds)) return;
    this.offset = Math.max(0, Math.min(this.buffer.duration - 0.01, positionSeconds));
    if (this.playing) this.play(this.offset);
  }
  currentPosition(): number {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    const context = this.runtime.prepareContext();
    const elapsed = context.currentTime - this.startedAt;
    return Math.max(0, Math.min(this.buffer.duration, this.offset + elapsed * this.speed));
  }
  stop(): void {
    try { this.source?.stop(); } catch { /* Already stopped. */ }
    this.source?.disconnect(); this.gain?.disconnect();
    this.source = undefined; this.gain = undefined; this.playing = false;
  }
  dispose(): void { this.stop(); this.buffer = undefined; }
}
