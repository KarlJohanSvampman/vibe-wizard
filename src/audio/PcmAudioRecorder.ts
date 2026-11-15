/** Captures a Web Audio node as interleaved PCM WAV without lossy MediaRecorder codecs. */
export class PcmAudioRecorder {
  private readonly processor: ScriptProcessorNode;
  private readonly silentGain: GainNode;
  private readonly chunks: Float32Array[][] = [];
  private stopped = false;
  private sampleCount = 0;

  constructor(
    private readonly context: AudioContext,
    source: AudioNode,
    private readonly maxDurationSeconds = 600,
  ) {
    if (context.state === 'closed') throw new Error('Audio context is closed.');
    this.processor = context.createScriptProcessor(4096, 2, 2);
    this.silentGain = context.createGain();
    this.silentGain.gain.value = 0;
    this.processor.onaudioprocess = event => {
      if (this.stopped) return;
      const input = event.inputBuffer;
      const channels = Math.min(2, input.numberOfChannels);
      const frameCount = input.length;
      if ((this.sampleCount + frameCount) / context.sampleRate > this.maxDurationSeconds) {
        this.stopped = true;
        return;
      }
      const chunk: Float32Array[] = [];
      for (let channel = 0; channel < channels; channel++) {
        chunk.push(new Float32Array(input.getChannelData(channel)));
      }
      if (channels === 1) chunk.push(new Float32Array(chunk[0]!));
      this.chunks.push(chunk);
      this.sampleCount += frameCount;
    };
    source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(context.destination);
  }

  get durationSeconds(): number {
    return this.sampleCount / this.context.sampleRate;
  }

  stop(): ArrayBuffer {
    if (!this.stopped) this.stopped = true;
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    this.silentGain.disconnect();
    if (this.sampleCount === 0) throw new Error('No audio was captured. Start playback before recording.');
    return this.encodeWav();
  }

  private encodeWav(): ArrayBuffer {
    const channels = 2;
    const bytesPerSample = 2;
    const dataBytes = this.sampleCount * channels * bytesPerSample;
    const output = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(output);
    const writeText = (offset: number, value: string): void => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, this.context.sampleRate, true);
    view.setUint32(28, this.context.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataBytes, true);
    let frame = 0;
    for (const chunk of this.chunks) {
      for (let index = 0; index < chunk[0]!.length; index++, frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const sample = Math.max(-1, Math.min(1, chunk[channel]![index]!));
          const integer = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          view.setInt16(44 + (frame * channels + channel) * 2, integer, true);
        }
      }
    }
    this.chunks.length = 0;
    return output;
  }
}
