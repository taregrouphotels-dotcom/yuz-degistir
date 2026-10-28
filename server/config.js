import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  inviteCodes: list(process.env.INVITE_CODES),
  provider: process.env.PROVIDER || 'pruna',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 1),
  retentionHours: Number(process.env.RETENTION_HOURS || 24),

  // Spesifikasyon: 5–10 sn. Telefon kayıtlarındaki küçük sapmalar için hafif tolerans.
  video: { minSeconds: 3, maxSeconds: 10.5, maxUploadMb: 100 },
  photos: { max: 4 },

  pruna: {
    apiKey: process.env.PRUNA_API_KEY,
    resolution: process.env.PRUNA_RESOLUTION || '720p',
  },
  wan: {
    token: process.env.REPLICATE_API_TOKEN,
    model: process.env.WAN_MODEL || 'wan-video/wan-2.2-animate-replace',
    videoField: process.env.WAN_VIDEO_FIELD || 'video',
    imageField: process.env.WAN_IMAGE_FIELD || 'character_image',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: process.env.SUPABASE_BUCKET || 'results',
  },
  watermarkPath: path.join(ROOT, 'assets', 'ai-badge.png'),
  charactersFile: path.join(ROOT, 'characters', 'characters.json'),
  characterImagesDir: path.join(ROOT, 'public', 'characters'),
};
