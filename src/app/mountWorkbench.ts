import { AudioEngine } from '../audio/AudioEngine.js';
import { Rack } from '../rack/Rack.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import { ThereminController } from '../controllers/theremin/ThereminController.js';

export function mountWorkbench(root: HTMLElement): void {
  const rack = new Rack();
  const synth = rack.add(new AudioEngine('synth-main'));
  const parameterBus = new ParameterBus();
  parameterBus.registerTarget(synth);

  const theremin = rack.add(new ThereminController('theremin-main', parameterBus));
  parameterBus.addMapping({
    id: 'theremin-x-to-synth-pitch',
    sourceModuleId: theremin.id,
    sourcePortId: 'x',
    targetModuleId: synth.id,
    targetParameterId: 'pitch',
    inputRange: [0, 1],
    outputRange: [48, 84],
    curve: 'linear',
    invert: false,
    deadZone: 0,
    smoothingMs: 10,
  });
  parameterBus.addMapping({
    id: 'theremin-y-to-synth-volume',
    sourceModuleId: theremin.id,
    sourcePortId: 'y',
    targetModuleId: synth.id,
    targetParameterId: 'volume',
    inputRange: [0, 1],
    outputRange: [0.025, 0.65],
    curve: 'linear',
    invert: false,
    deadZone: 0,
    smoothingMs: 14,
  });

  root.innerHTML = `
    <section class="workbench-card">
      <header class="workbench-header">
        <div>
          <p class="eyebrow">IMMERSIVE MUSIC WORKSTATION</p>
          <h1>Vibe-Wizard</h1>
          <p class="subtitle">Create instruments. Shape sounds. Make music.</p>
        </div>
        <span class="prototype-tag">PROTOTYPE 01</span>
      </header>

      <div class="signal-row">
        <span class="signal-dot" id="audio-status-dot"></span>
        <span id="audio-status" role="status">Audio is stopped</span>
        <button class="action-button" id="enable-audio" type="button">Enable audio</button>
      </div>

      <div class="controller-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">LIVE CONTROLLER</p>
            <h2>Virtual theremin</h2>
          </div>
          <span class="module-chip">THEREMIN · 2 AXIS</span>
        </div>

        <label class="control-row" for="theremin-x">
          <span><strong>X · Pitch</strong><small>Low notes ← → High notes</small></span>
          <input id="theremin-x" type="range" min="0" max="1" value="0.5" step="0.001" />
        </label>
        <label class="control-row" for="theremin-y">
          <span><strong>Y · Volume</strong><small>Quiet ← → Loud</small></span>
          <input id="theremin-y" type="range" min="0" max="1" value="0.55" step="0.001" />
        </label>

        <div class="controller-readout">
          <span>X <strong id="x-value">0.500</strong></span>
          <span>Y <strong id="y-value">0.550</strong></span>
          <span>Pitch <strong id="pitch-value">66.0</strong></span>
        </div>

        <button class="play-button" id="play-theremin" type="button">
          <span class="play-symbol">▶</span>
          <span><strong>Play theremin</strong><small>Press and hold to sustain a tone</small></span>
        </button>
      </div>

      <footer class="workbench-footer">
        <span>GLOBAL RACK</span>
        <span>THEREMIN → PARAMETER BUS → SYNTH</span>
        <span>LOCAL AUDIO</span>
      </footer>
    </section>
  `;

  const enableButton = root.querySelector<HTMLButtonElement>('#enable-audio');
  const playButton = root.querySelector<HTMLButtonElement>('#play-theremin');
  const xInput = root.querySelector<HTMLInputElement>('#theremin-x');
  const yInput = root.querySelector<HTMLInputElement>('#theremin-y');
  const status = root.querySelector<HTMLElement>('#audio-status');
  const statusDot = root.querySelector<HTMLElement>('#audio-status-dot');
  const xValue = root.querySelector<HTMLElement>('#x-value');
  const yValue = root.querySelector<HTMLElement>('#y-value');
  const pitchValue = root.querySelector<HTMLElement>('#pitch-value');

  if (!enableButton || !playButton || !xInput || !yInput || !status ||
      !statusDot || !xValue || !yValue || !pitchValue) {
    throw new Error('The workbench UI is missing a required control.');
  }

  let audioReady = false;
  let isPlaying = false;

  const updateController = (): void => {
    const x = Number(xInput.value);
    const y = Number(yInput.value);
    theremin.move(x, y);
    xValue.textContent = x.toFixed(3);
    yValue.textContent = y.toFixed(3);
    pitchValue.textContent = (48 + x * 36).toFixed(1);
  };

  const enableAudio = async (): Promise<void> => {
    try {
      await synth.start();
      audioReady = true;
      status.textContent = 'Audio engine running';
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
      updateController();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not start audio';
    }
  };

  const startTone = async (): Promise<void> => {
    if (!audioReady) await enableAudio();
    if (!audioReady || isPlaying) return;

    synth.noteOn({
      kind: 'note-on',
      sourceId: theremin.id,
      noteId: 'theremin-live-note',
      pitch: 66,
      velocity: 0.55,
      timestamp: performance.now() / 1000,
    });
    isPlaying = true;
    playButton.classList.add('is-playing');
    updateController();
  };

  const stopTone = (): void => {
    if (!isPlaying) return;
    synth.noteOff({
      kind: 'note-off',
      sourceId: theremin.id,
      noteId: 'theremin-live-note',
      timestamp: performance.now() / 1000,
    });
    isPlaying = false;
    playButton.classList.remove('is-playing');
  };

  enableButton.addEventListener('click', () => void enableAudio());
  xInput.addEventListener('input', updateController);
  yInput.addEventListener('input', updateController);
  playButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    playButton.setPointerCapture(event.pointerId);
    void startTone();
  });
  playButton.addEventListener('pointerup', stopTone);
  playButton.addEventListener('pointercancel', stopTone);
  playButton.addEventListener('lostpointercapture', stopTone);
  window.addEventListener('blur', stopTone);

  updateController();
}
