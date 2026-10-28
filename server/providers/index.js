import { mock } from './mock.js';
import { pruna } from './pruna.js';
import { wan } from './wan.js';

export const providers = { pruna, wan, mock };

export function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Bilinmeyen servis: ${name} (pruna | wan | mock)`);
  return p;
}

export function buildPrompt({ custom }) {
  const who = custom
    ? 'the person shown in the reference images (all reference images show the same person)'
    : 'the character from reference image 1';
  return (
    `Replace the person in the source video with ${who}. ` +
    'Keep the identity of the reference consistent in every frame. ' +
    'Keep lip sync, facial expressions, head and hand motion, audio, background, lighting and camera from the source video.'
  );
}
