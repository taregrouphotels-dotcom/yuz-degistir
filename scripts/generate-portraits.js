// 10 test karakterinin portre adaylarını Pruna p-image ile üretir (görsel başına ~0,005 $).
//
//   npm run portraits -- --variants 3 [--characters cocuk,korsan]
//
// Adaylar reports/portraits/<karakter>/ altına yazılır; seçilen aday
// public/characters/<image> adıyla kopyalanır.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config, ROOT } from '../server/config.js';
import { downloadResult, predict } from '../server/providers/pruna.js';

const { values: args } = parseArgs({
  options: {
    variants: { type: 'string', default: '3' },
    characters: { type: 'string', default: 'all' },
  },
});

if (!config.pruna.apiKey) throw new Error("PRUNA_API_KEY .env'de tanımlı değil.");

const STYLE =
  'Photorealistic candid portrait photograph of {who}. Chest-up framing, centered, facing the camera directly, ' +
  'looking straight into the lens, mouth closed, relaxed natural expression. Soft even frontal lighting, no harsh shadows, ' +
  'plain light grey studio background, sharp focus on the face, natural skin texture with pores, shot on a 50mm lens, ' +
  'realistic color. Fully clothed. Only one person in the frame, no hands visible, no text, no watermark.';

const all = JSON.parse(await fs.readFile(config.charactersFile, 'utf8'));
const wanted = args.characters === 'all' ? null : new Set(args.characters.split(','));
const outRoot = path.join(ROOT, 'reports', 'portraits');

for (const c of all.filter((c) => !wanted || wanted.has(c.id))) {
  const dir = path.join(outRoot, c.id);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    Array.from({ length: Number(args.variants) }, async (_, i) => {
      const state = await predict('p-image', { prompt: STYLE.replace('{who}', c.prompt), aspect_ratio: '3:4' });
      const file = path.join(dir, `aday-${i + 1}.jpg`);
      await downloadResult(state.generation_url, file);
      console.log(`${c.id}: ${path.relative(ROOT, file)}`);
    }),
  );
}
console.log(`\nAdaylar: ${path.relative(ROOT, outRoot)}/`);
