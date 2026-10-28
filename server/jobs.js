import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { finalizeVideo, normalizeVideo, probe } from './media.js';
import { buildPrompt, getProvider } from './providers/index.js';
import { publishResult, removeResult } from './storage.js';

const jobs = new Map();
const queue = [];
let running = 0;

export const jobDir = (id) => path.join(config.dataDir, 'jobs', id);

export async function createJob({ videoPath, imagePaths, custom, characterId, providerName }) {
  const id = crypto.randomUUID();
  const dir = jobDir(id);
  await fs.mkdir(dir, { recursive: true });

  // Yüklenen dosyaları işin klasörüne taşı; temizlik tek yerden yapılır.
  const move = async (from, name) => {
    const to = path.join(dir, name);
    await fs.rename(from, to);
    return to;
  };
  videoPath = await move(videoPath, `upload${path.extname(videoPath)}`);
  if (custom) imagePaths = await Promise.all(imagePaths.map((f, i) => move(f, `photo-${i}${path.extname(f)}`)));

  const job = {
    id,
    provider: providerName,
    characterId: characterId || null,
    custom,
    status: 'queued',
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    timings: {},
    resultUrl: null,
    dir,
    input: { videoPath, imagePaths },
  };
  jobs.set(id, job);
  queue.push(job);
  pump();
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    provider: job.provider,
    queuePosition: job.status === 'queued' ? queue.indexOf(job) + 1 : 0,
    elapsedSeconds: Math.round(((job.finishedAt || Date.now()) - job.createdAt) / 1000),
    timings: job.timings,
    resultUrl: job.status === 'done' ? job.resultUrl || `/api/jobs/${job.id}/result` : null,
  };
}

function pump() {
  while (running < config.maxConcurrentJobs && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job)
      .catch((err) => {
        console.error(`[iş ${job.id}]`, err);
        job.status = 'failed';
        job.error = err.message;
      })
      .finally(async () => {
        job.finishedAt = Date.now();
        running--;
        // Kişi fotoğrafları iş bitince hemen silinir.
        if (job.custom) await Promise.all(job.input.imagePaths.map((f) => fs.rm(f, { force: true })));
        pump();
      });
  }
}

async function timed(job, name, fn) {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    job.timings[name] = Number(((Date.now() - t) / 1000).toFixed(1));
  }
}

async function runJob(job) {
  job.startedAt = Date.now();
  const provider = getProvider(job.provider);
  const normalized = path.join(job.dir, 'input.mp4');

  job.status = 'preparing';
  await timed(job, 'prepare', () => normalizeVideo(job.input.videoPath, normalized));

  const generated = await timed(job, 'provider', () =>
    provider.generate({
      videoPath: normalized,
      imagePaths: job.input.imagePaths.slice(0, provider.maxImages),
      prompt: buildPrompt({ custom: job.custom }),
      workDir: job.dir,
      onStatus: (s) => (job.status = s),
    }),
  );

  job.status = 'finishing';
  const result = path.join(job.dir, 'result.mp4');
  await timed(job, 'finish', () => finalizeVideo({ generated, original: normalized, output: result }));
  // Depolama hatası işi düşürmez; sonuç sunucunun diskinden verilir.
  job.resultUrl = await publishResult(job.id, result).catch((err) => {
    console.error(`[iş ${job.id}] sonuç depolamaya yüklenemedi, yerelden verilecek:`, err.message);
    return null;
  });
  job.resultSeconds = (await probe(result)).duration;
  job.status = 'done';
  job.timings.total = Number(((Date.now() - job.createdAt) / 1000).toFixed(1));
  console.log(`[iş ${job.id}] tamamlandı`, job.provider, job.timings);
}

// Eski işleri ve dosyaları temizler.
export function startCleanup() {
  const maxAge = config.retentionHours * 3600 * 1000;
  const sweep = async () => {
    for (const [id, job] of jobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > maxAge) {
        jobs.delete(id);
        await fs.rm(job.dir, { recursive: true, force: true });
        await removeResult(id).catch(() => {});
      }
    }
    // Yeniden başlatma sonrası sahipsiz kalan klasörler
    const root = path.join(config.dataDir, 'jobs');
    const entries = await fs.readdir(root).catch(() => []);
    for (const name of entries) {
      if (jobs.has(name)) continue;
      const stat = await fs.stat(path.join(root, name)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > maxAge) await fs.rm(path.join(root, name), { recursive: true, force: true });
    }
  };
  setInterval(() => sweep().catch(console.error), 30 * 60 * 1000).unref();
}
