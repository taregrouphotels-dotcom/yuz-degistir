// API anahtarı olmadan uçtan uca akışı denemek için: videoyu değiştirmeden geri döndürür.
import fs from 'node:fs/promises';
import path from 'node:path';
import { sleep } from './http.js';

export const mock = {
  name: 'mock',
  label: 'Deneme (dönüşüm yok)',
  maxImages: 4,

  isConfigured: () => true,

  async generate({ videoPath, workDir, onStatus, signal }) {
    onStatus('uploading');
    await sleep(500, signal);
    onStatus('generating');
    await sleep(3000, signal);
    const out = path.join(workDir, 'generated.mp4');
    await fs.copyFile(videoPath, out);
    return out;
  },
};
