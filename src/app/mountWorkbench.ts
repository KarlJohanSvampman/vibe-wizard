import { VisibilityState, type World } from '@iwsdk/core';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Rack } from '../rack/Rack.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import { ThereminController } from '../controllers/theremin/ThereminController.js';
import { ThereminSpatialAdapter } from '../controllers/theremin/ThereminSpatialAdapter.js';

export function mountWorkbench(root: HTMLElement, world: World): void {
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

  let spatialNoteId: string | undefined;
  let spatialNoteCounter = 0;

  const spatialAdapter = new ThereminSpatialAdapter(world, theremin, {
    handedness: 'right',
    onActiveChange: (active, point, time) => {
      if (active && point) {
        spatialNoteCounter += 1;
        spatialNoteId = 'theremin-spatial-note-' + spatialNoteCounter;
        synth.noteOn({
          kind: 'note-on',
          sourceId: theremin.id,
          noteId: spatialNoteId,
          pitch: 48 + point.x * 36,
          velocity: 0.85,
          timestamp: time,
        });
      } else if (spatialNoteId) {
        synth.noteOff({
          kind: 'note-off',
          sourceId: theremin.id,
          noteId: spatialNoteId,
          timestamp: time,
        });
        spatialNoteId = undefined;
      }
    },
  });

  root.innerHTML = [
    '<section class="workbench-card">',
    '  <header class="workbench-header">',
    '    <div>',
    '      <p class="eyebrow">IMMERSIVE MUSIC WORKSTATION</p>',
    '      <h1>Vibe-Wizard</h1>',
    '      <p class="subtitle">Create instruments. Shape sounds. Make music.</p>',
    '    </div>',
    '    <span class="prototype-tag">PROTOTYPE 02</span>',
    '  </header>',
    '  <div class="signal-row">',
    '    <span class="signal-dot" id="audio-status-dot"></span>',
    '    <span id="audio-status" role="status">Audio is stopped</span>',
    '    <button class="action-button" id="enable-audio" type="button">Enable audio</button>',
    '    <button class="action-button enter-vr-button" id="enter-vr" type="button">Enter VR</button>',
    '  </div>',
    '  <div class="controller-panel">',
    '    <div class="section-heading">',
    '      <div><p class="eyebrow">LIVE CONTROLLER</p><h2>Virtual theremin</h2></div>',
    '      <span class="module-chip">THEREMIN · 2 AXIS</span>',
    '    </div>',
    '    <label class="control-row" for="theremin-x">',
    '      <span><strong>X · Pitch</strong><small>Low notes ← → High notes</small></span>',
    '      <input id="theremin-x" type="range" min="0" max="1" value="0.5" step="0.001" />',
    '    </label>',
    '    <label class="control-row" for="theremin-y">',
    '      <span><strong>Y · Volume</strong><small>Quiet at bottom · Loud at top</small></span>',
    '      <input id="theremin-y" type="range" min="0" max="1" value="0.55" step="0.001" />',
    '    </label>',
    '    <div class="controller-readout">',
    '      <span>X <strong id="x-value">0.500</strong></span>',
    '      <span>Y <strong id="y-value">0.550</strong></span>',
    '      <span>Pitch <strong id="pitch-value">66.0</strong></span>',
    '    </div>',
    '    <button class="play-button" id="play-theremin" type="button">',
    '      <span class="play-symbol">▶</span>',
    '      <span><strong>Play theremin</strong><small>Press and hold to sustain a tone on desktop</small></span>',
    '    </button>',
    '    <p class="spatial-hint">In VR, enter the session and move your right index fingertip into the floating field. Horizontal movement changes pitch; vertical movement changes volume.</p>',
    '  </div>',
    '  <footer class="workbench-footer">',
    '    <span>GLOBAL RACK</span><span>THEREMIN → PARAMETER BUS → SYNTH</span><span>LOCAL AUDIO</span>',
    '  </footer>',
    '</section>',
  ].join('');

  const enableButton = root.querySelector<HTMLButtonElement>('#enable-audio');
  const enterVrButton = root.querySelector<HTMLButtonElement>('#enter-vr');
  const playButton = root.querySelector<HTMLButtonElement>('#play-theremin');
  const xInput = root.querySelector<HTMLInputElement>('#theremin-x');
  const yInput = root.querySelector<HTMLInputElement>('#theremin-y');
  const status = root.querySelector<HTMLElement>('#audio-status');
  const statusDot = root.querySelector<HTMLElement>('#audio-status-dot');
  const xValue = root.querySelector<HTMLElement>('#x-value');
  const yValue = root.querySelector<HTMLElement>('#y-value');
  const pitchValue = root.querySelector<HTMLElement>('#pitch-value');

  if (!enableButton || !enterVrButton || !playButton || !xInput || !yInput ||
      !status || !statusDot || !xValue || !yValue || !pitchValue) {
    spatialAdapter.dispose();
    throw new Error('The workbench UI is missing a required control.');
  }

  let audioReady = false;
  let isPlaying = false;
  const desktopNoteId = 'theremin-desktop-note';

  const updateController = (): void => {
    const x = Number(xInput.value);
    const y = Number(yInput.value);
    theremin.move(x, y);
    xValue.textContent = x.toFixed(3);
    yValue.textContent = y.toFixed(3);
    pitchValue.textContent = (48 + x * 36).toFixed(1);
  };

  const updateStatus = (message: string): void => {
    status.textContent = message;
  };

  const enableAudio = async (): Promise<void> => {
    try {
      await synth.start();
      audioReady = true;
      updateStatus('Audio engine running');
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'Could not start audio');
      throw error;
    }
  };

  const startTone = async (): Promise<void> => {
    if (!audioReady) {
      try {
        await enableAudio();
      } catch {
        return;
      }
    }
    if (!audioReady || isPlaying) return;

    const x = Number(xInput.value);
    synth.noteOn({
      kind: 'note-on',
      sourceId: theremin.id,
      noteId: desktopNoteId,
      pitch: 48 + x * 36,
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
      noteId: desktopNoteId,
      timestamp: performance.now() / 1000,
    });
    isPlaying = false;
    playButton.classList.remove('is-playing');
  };

  enableButton.addEventListener('click', () => void enableAudio().catch(() => undefined));

  enterVrButton.addEventListener('click', () => {
    // Invoke both APIs inside this gesture so browser user activation is
    // available to AudioContext.resume() and the WebXR session request.
    const audioStart = synth.start();
    const xrStart = world.launchXR();
    void Promise.all([audioStart, xrStart]).then(() => {
      audioReady = true;
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
      enterVrButton.textContent = 'VR active';
      enterVrButton.disabled = true;
      updateStatus('VR ready · move your right index fingertip into the field');
    }).catch((error: unknown) => {
      updateStatus(error instanceof Error ? error.message : 'Could not enter VR');
      enterVrButton.disabled = false;
    });
  });

  world.visibilityState.subscribe((state) => {
    const immersive = state !== VisibilityState.NonImmersive;
    enterVrButton.disabled = immersive;
    enterVrButton.textContent = immersive ? 'VR active' : 'Enter VR';
    if (!immersive && audioReady) {
      updateStatus('Audio engine running');
    }
  });

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
