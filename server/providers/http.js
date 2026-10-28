import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('İptal edildi'));
    }, { once: true });
  });

export async function requestJson(url, options, label) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = body.error || body.detail || body.message || text.slice(0, 300);
    throw new Error(`${label} başarısız (${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return body;
}

// Çok parçalı form ile dosya yükler (Pruna ve Replicate ikisi de "content" alanını kullanır).
export async function uploadFile(url, headers, filePath, label) {
  const form = new FormData();
  const blob = await fs.openAsBlob(filePath);
  form.append('content', blob, filePath.split('/').pop());
  return requestJson(url, { method: 'POST', headers, body: form }, label);
}

export async function download(url, headers, dest) {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`Sonuç indirilemedi (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}
