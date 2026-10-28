import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config, ROOT } from './config.js';
import { createJob, getJob, jobDir, publicJob, startCleanup } from './jobs.js';
import { probe } from './media.js';
import { getProvider, providers } from './providers/index.js';
import { storageMode } from './storage.js';

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.video.maxUploadMb * 1024 * 1024, files: 1 + config.photos.max },
  fileFilter: (_req, file, cb) => {
    // Bazı tarayıcılar türü boş ya da octet-stream gönderir; o durumda uzantıya bakılır.
    const ext = path.extname(file.originalname).toLowerCase();
    const ok =
      file.fieldname === 'video'
        ? /^video\//.test(file.mimetype) || ['.mp4', '.mov', '.m4v', '.webm', '.3gp'].includes(ext)
        : /^image\/(jpeg|png|webp)$/.test(file.mimetype) || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    cb(ok ? null : new HttpError(400, 'Desteklenmeyen dosya türü.'), ok);
  },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const loadCharacters = () => {
  const list = JSON.parse(fs.readFileSync(config.charactersFile, 'utf8'));
  return list.map((c) => ({
    ...c,
    available: fs.existsSync(path.join(config.characterImagesDir, c.image)),
    imageUrl: `/characters/${c.image}`,
  }));
};

function requireInvite(req, _res, next) {
  const code = req.get('x-invite-code') || '';
  if (!config.inviteCodes.length) return next(new HttpError(503, 'Sunucuda davet kodu tanımlı değil (INVITE_CODES).'));
  if (!config.inviteCodes.includes(code.trim())) return next(new HttpError(401, 'Davet kodu geçersiz.'));
  next();
}

// Render, yayındaki commit'i RENDER_GIT_COMMIT ile verir; hangi sürümün çalıştığı buradan görülür.
app.get('/healthz', (_req, res) => res.send(`ok ${(process.env.RENDER_GIT_COMMIT || 'yerel').slice(0, 7)}`));

app.post('/api/login', requireInvite, (_req, res) => res.json({ ok: true }));

app.get('/api/config', requireInvite, (_req, res) => {
  res.json({
    video: config.video,
    photos: config.photos,
    defaultProvider: config.provider,
    providers: Object.values(providers)
      .filter((p) => p.isConfigured() && (p.name !== 'mock' || config.provider === 'mock'))
      .map((p) => ({ name: p.name, label: p.label })),
    characters: loadCharacters(),
    storage: storageMode,
  });
});

app.post(
  '/api/jobs',
  requireInvite,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'photos', maxCount: config.photos.max }]),
  async (req, res, next) => {
    const files = [...(req.files?.video || []), ...(req.files?.photos || [])];
    const discard = () => Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
    try {
      const video = req.files?.video?.[0];
      if (!video) throw new HttpError(400, 'Video gelmedi.');

      const providerName = req.body.provider || config.provider;
      const provider = getProvider(providerName);
      if (!provider.isConfigured()) throw new HttpError(400, `${provider.label} için API anahtarı tanımlı değil.`);

      const info = await probe(video.path).catch(() => null);
      if (!info?.hasVideo) throw new HttpError(400, 'Video okunamadı. Başka bir video deneyin.');
      if (info.duration > config.video.maxSeconds) throw new HttpError(400, `Video en fazla 10 saniye olmalı (bu video ${info.duration.toFixed(1)} sn).`);
      if (info.duration < config.video.minSeconds) throw new HttpError(400, `Video çok kısa (${info.duration.toFixed(1)} sn). 5–10 saniye çekin.`);

      let imagePaths;
      let custom = false;
      let characterId = null;
      if (req.body.characterId) {
        const character = loadCharacters().find((c) => c.id === req.body.characterId);
        if (!character?.available) throw new HttpError(400, 'Bu karakter henüz hazır değil.');
        characterId = character.id;
        imagePaths = [path.join(config.characterImagesDir, character.image)];
      } else {
        const photos = req.files?.photos || [];
        if (!photos.length) throw new HttpError(400, 'Karakter seçin ya da fotoğraf yükleyin.');
        if (req.body.consent !== 'true') {
          throw new HttpError(400, 'Fotoğraftaki kişinin izni olduğunu onaylamanız gerekiyor.');
        }
        custom = true;
        imagePaths = photos.map((p) => p.path);
      }

      const job = await createJob({ videoPath: video.path, imagePaths, custom, characterId, providerName });
      res.status(202).json(publicJob(job));
    } catch (err) {
      await discard();
      next(err);
    }
  },
);

app.get('/api/jobs/:id', (req, res, next) => {
  const job = getJob(req.params.id);
  if (!job) return next(new HttpError(404, 'İş bulunamadı.'));
  res.json(publicJob(job));
});

// İş kimliği tahmin edilemez bir UUID; <video> etiketi başlık gönderemediği için bağlantının kendisi anahtardır.
app.get('/api/jobs/:id/result', (req, res, next) => {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'done') return next(new HttpError(404, 'Sonuç bulunamadı.'));
  if (req.query.download) res.attachment(`donusum-${job.id.slice(0, 8)}.mp4`);
  res.sendFile(path.join(jobDir(job.id), 'result.mp4'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Dosya çok büyük (en fazla ${config.video.maxUploadMb} MB).` : 'Yükleme hatası.';
    return res.status(400).json({ error: msg });
  }
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Sunucu hatası.' });
});

startCleanup();
app.listen(config.port, () => {
  console.log(`Yüz değiştirme demosu: http://localhost:${config.port}`);
  console.log(`Servis: ${config.provider} · Depolama: ${storageMode} · Davet kodu sayısı: ${config.inviteCodes.length}`);
});
