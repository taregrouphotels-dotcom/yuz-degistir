// Wan 2.2 Animate – Replace, Replicate üzerinden.
// Girdi alan adları .env'den gelir; Replicate model sayfasındaki API şemasıyla doğrulanmalı.
import path from 'node:path';
import { config } from '../config.js';
import { download, requestJson, sleep, uploadFile } from './http.js';

const API = 'https://api.replicate.com/v1';

export const wan = {
  name: 'wan',
  label: 'Wan 2.2 Animate – Replace',
  maxImages: 1,

  isConfigured: () => Boolean(config.wan.token),

  async generate({ videoPath, imagePaths, workDir, onStatus, signal }) {
    const auth = { Authorization: `Bearer ${config.wan.token}` };

    onStatus('uploading');
    const [video, image] = await Promise.all(
      [videoPath, imagePaths[0]].map((f) => uploadFile(`${API}/files`, auth, f, 'Replicate dosya yükleme')),
    );

    onStatus('generating');
    let state = await requestJson(
      `${API}/models/${config.wan.model}/predictions`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            [config.wan.videoField]: video.urls.get,
            [config.wan.imageField]: image.urls.get,
          },
        }),
        signal,
      },
      'Replicate iş oluşturma',
    );

    while (state.status !== 'succeeded') {
      if (state.status === 'failed' || state.status === 'canceled') {
        throw new Error(`Wan işi başarısız: ${state.error || state.status}`);
      }
      await sleep(2000, signal);
      state = await requestJson(state.urls.get, { headers: auth, signal }, 'Replicate durum sorgusu');
    }

    onStatus('downloading');
    const output = Array.isArray(state.output) ? state.output[0] : state.output;
    return download(output, auth, path.join(workDir, 'generated.mp4'));
  },
};
