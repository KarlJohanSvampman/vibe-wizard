/**
 * Shared lazy AudioContext for all instruments and track buses in one project.
 * Starting it remains a user-gesture responsibility of the application.
 */
export class AudioRuntime {
  private audioContext: AudioContext | undefined;
  private resumePromise: Promise<void> | undefined;
  private disposed = false;

  /** Create the context without resuming it, so the graph can be prepared synchronously. */
  prepareContext(): AudioContext {
    if (this.disposed) throw new Error('Cannot prepare a disposed audio runtime.');
    if (!this.audioContext) this.audioContext = new AudioContext();
    return this.audioContext;
  }

  async start(): Promise<void> {
    const context = this.prepareContext();
    if (context.state !== 'running') {
      this.resumePromise ??= context.resume().finally(() => {
        this.resumePromise = undefined;
      });
      await this.resumePromise;
    }
  }

  get context(): AudioContext | undefined {
    return this.audioContext;
  }

  get isRunning(): boolean {
    return this.audioContext?.state === 'running';
  }

  get currentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  requireContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      throw new Error('Audio is not ready. Start the audio runtime from a user gesture first.');
    }
    return this.audioContext;
  }

  toAudioTime(performanceTimestamp: number): number {
    const context = this.requireContext();
    const offset = context.currentTime - performance.now() / 1000;
    return Math.max(context.currentTime, performanceTimestamp + offset);
  }

  performanceTimeForAudioTime(audioTime: number): number {
    const context = this.requireContext();
    return performance.now() / 1000 + (audioTime - context.currentTime);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const context = this.audioContext;
    this.audioContext = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
