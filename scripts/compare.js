// İki servisi aynı test videolarıyla karşılaştırır.
//
//   npm run compare -- --providers pruna,wan --videos test-videos --characters all
//
// Her (servis × video × karakter) için üretim süresini ölçer, sonuç videolarını ve
// yan yana izleme sayfasını reports/<zaman>/ altına yazar. Kalite puanları
// (titreme, dudak uyumu) izlenip report.csv'deki boş sütunlara elle girilir.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config, ROOT } from '../server/config.js';
import { finalizeVideo, normalizeVideo, probe } from '../server/media.js';
import { buildPrompt, getProvider } from '../server/providers/index.js';

const { values: args } = parseArgs({
  options: {
    providers: { type: 'string', default: 'pruna,wan' },
    videos: { type: 'string', default: 'test-videos' },
    characters: { type: 'string', default: 'all' },
  },
});

const providers = args.providers.split(',').map((n) => getProvider(n.trim()));
for (const p of providers) {
  if (!p.isConfigured()) throw new Error(`${p.label} için API anahtarı .env'de tanımlı değil.`);
}

const videoDir = path.resolve(ROOT, args.videos);
const videos = (await fs.readdir(videoDir)).filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f)).sort();
if (!videos.length) throw new Error(`${videoDir} içinde video yok.`);

const allCharacters = JSON.parse(await fs.readFile(config.charactersFile, 'utf8'));
const wanted = args.characters === 'all' ? null : new Set(args.characters.split(','));
const characters = [];
for (const c of allCharacters) {
  if (wanted && !wanted.has(c.id)) continue;
  const image = path.join(config.characterImagesDir, c.image);
  if (await fs.stat(image).catch(() => null)) characters.push({ ...c, imagePath: image });
  else console.warn(`Atlandı (portre yok): ${c.id}`);
}

const outDir = path.join(ROOT, 'reports', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(outDir, { recursive: true });

// Videoları bir kez normalize et
const inputs = [];
for (const v of videos) {
  const out = path.join(outDir, `input-${path.parse(v).name}.mp4`);
  await normalizeVideo(path.join(videoDir, v), out);
  inputs.push({ name: path.parse(v).name, path: out, duration: (await probe(out)).duration });
}

const rows = [];
const total = providers.length * inputs.length * characters.length;
let n = 0;
for (const provider of providers) {
  for (const input of inputs) {
    for (const character of characters) {
      n++;
      const label = `${provider.name}/${input.name}/${character.id}`;
      const workDir = path.join(outDir, 'work', label.replaceAll('/', '_'));
      await fs.mkdir(workDir, { recursive: true });
      const row = { provider: provider.name, video: input.name, character: character.id, input_seconds: input.duration.toFixed(1) };
      const t0 = Date.now();
      try {
        const generated = await provider.generate({
          videoPath: input.path,
          imagePaths: [character.imagePath],
          prompt: buildPrompt({ custom: false }),
          workDir,
          onStatus: () => {},
        });
        row.provider_seconds = ((Date.now() - t0) / 1000).toFixed(1);
        const result = path.join(outDir, `${label.replaceAll('/', '_')}.mp4`);
        const { reattachedAudio } = await finalizeVideo({ generated, original: input.path, output: result });
        row.total_seconds = ((Date.now() - t0) / 1000).toFixed(1);
        row.audio_reattached = reattachedAudio;
        row.file = path.basename(result);
        row.status = 'ok';
      } catch (err) {
        row.status = 'hata';
        row.error = err.message;
      }
      rows.push(row);
      console.log(`[${n}/${total}] ${label}: ${row.status} ${row.total_seconds ?? ''} sn ${row.error ?? ''}`);
    }
  }
}

// CSV — puan sütunları izledikten sonra elle doldurulur (1–5)
const cols = ['provider', 'video', 'character', 'status', 'input_seconds', 'provider_seconds', 'total_seconds',
  'audio_reattached', 'file', 'error', 'puan_titreme_yok', 'puan_dudak_uyumu', 'puan_benzerlik', 'not'];
const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
await fs.writeFile(path.join(outDir, 'report.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));

// Özet
const summary = providers.map((p) => {
  const ok = rows.filter((r) => r.provider === p.name && r.status === 'ok');
  const secs = ok.map((r) => Number(r.total_seconds)).sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor(secs.length / 2)] : null;
  return {
    servis: p.label,
    basarili: `${ok.length}/${inputs.length * characters.length}`,
    medyan_sn: median,
    en_uzun_sn: secs.at(-1) ?? null,
    bir_dakika_altinda: `${secs.filter((s) => s <= 60).length}/${secs.length}`,
  };
});
console.table(summary);

// Yan yana izleme sayfası
const html = `<!doctype html><meta charset="utf-8"><title>Servis karşılaştırması</title>
<style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}table{border-collapse:collapse}td,th{padding:6px;vertical-align:top;border:1px solid #333}video{width:220px}</style>
<h1>Servis karşılaştırması</h1><pre>${JSON.stringify(summary, null, 2)}</pre>
<table><tr><th>Video / Karakter</th>${providers.map((p) => `<th>${p.label}</th>`).join('')}</tr>
${inputs.flatMap((i) => characters.map((c) => `<tr><td>${i.name}<br>${c.name} — ${c.profile}<br><small>${c.tests}</small></td>${providers
  .map((p) => {
    const r = rows.find((x) => x.provider === p.name && x.video === i.name && x.character === c.id);
    return `<td>${r?.status === 'ok' ? `<video src="${r.file}" controls playsinline></video><br>${r.total_seconds} sn` : `hata: ${r?.error ?? ''}`}</td>`;
  })
  .join('')}</tr>`)).join('\n')}
</table>`;
await fs.writeFile(path.join(outDir, 'index.html'), html);
await fs.rm(path.join(outDir, 'work'), { recursive: true, force: true });
console.log(`\nRapor: ${outDir}/index.html ve report.csv`);
