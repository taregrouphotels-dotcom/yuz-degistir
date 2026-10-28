// Pruna P-Video-Replace
// https://docs.pruna.ai/en/stable/docs_pruna_endpoints/performance_models/p-video-replace.html
import path from 'node:path';
import { config } from '../config.js';
import { download, requestJson, sleep, uploadFile } from './http.js';

const API = 'https://api.pruna.ai/v1';

export const pruna = {
  name: 'pruna',
  label: 'Pruna P-Video-Replace',
  maxImages: 4,

  isConfigured: () => Boolean(config.pruna.apiKey),

  async generate({ videoPath, imagePaths, prompt, workDir, onStatus, signal }) {
    const auth = { apikey: config.pruna.apiKey };

    onStatus('uploading');
    const uploads = await Promise.all(
      [videoPath, ...imagePaths].map((f) => uploadFile(`${API}/files`, auth, f, 'Pruna dosya yükleme')),
    );
    const [video, ...images] = uploads.map((u) => u.urls?.get);

    onStatus('generating');
    const created = await requestJson(
      `${API}/predictions`,
      {
        method: 'POST',
        headers: { ...auth, Model: 'p-video-replace', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            video,
            images,
            instruction_prompt: prompt,
            resolution: config.pruna.resolution,
            save_audio: true,
          },
        }),
        signal,
      },
      'Pruna iş oluşturma',
    );

    let state = created;
    const pollUrl = created.get_url || `${API}/predictions/status/${created.id}`;
    while (state.status !== 'succeeded') {
      if (state.status === 'failed') {
        throw new Error(`Pruna işi başarısız: ${state.error || state.message || 'bilinmeyen hata'}`);
      }
      await sleep(2000, signal);
      state = await requestJson(pollUrl, { headers: auth, signal }, 'Pruna durum sorgusu');
    }

    onStatus('downloading');
    return download(state.generation_url, auth, path.join(workDir, 'generated.mp4'));
  },
};
