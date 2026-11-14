import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { mountWorkbench } from './app/mountWorkbench.js';
import './styles.css';

const sceneContainer = document.getElementById('scene-container');
const workbenchRoot = document.getElementById('workbench-root');

if (!(sceneContainer instanceof HTMLDivElement)) {
  throw new Error('Missing #scene-container element.');
}

World.create(sceneContainer, projectOptions)
  .then(() => {
    if (workbenchRoot) {
      mountWorkbench(workbenchRoot);
    }
  })
  .catch((error: unknown) => {
    console.error('Vibe-Wizard failed to initialize IWSDK.', error);
    const message = document.createElement('p');
    message.className = 'fatal-error';
    message.textContent = 'The 3D runtime could not be initialized. Check the console for details.';
    document.body.append(message);
  });
