// Sonuç videolarının saklanması: Supabase ayarlıysa Storage'a, değilse yerel diske.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

const supabase =
  config.supabase.url && config.supabase.key ? createClient(config.supabase.url, config.supabase.key) : null;

export const storageMode = supabase ? 'supabase' : 'local';

// Yerel modda null döner; sunucu dosyayı kendisi servis eder.
export async function publishResult(jobId, filePath) {
  if (!supabase) return null;
  const key = `${jobId}.mp4`;
  const { error } = await supabase.storage
    .from(config.supabase.bucket)
    .upload(key, fs.createReadStream(filePath), { contentType: 'video/mp4', upsert: true, duplex: 'half' });
  if (error) throw new Error(`Supabase yükleme hatası: ${error.message}`);
  const { data, error: signError } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(key, config.retentionHours * 3600, { download: `donusum-${jobId.slice(0, 8)}.mp4` });
  if (signError) throw new Error(`Supabase bağlantı hatası: ${signError.message}`);
  return data.signedUrl;
}

export async function removeResult(jobId) {
  if (supabase) await supabase.storage.from(config.supabase.bucket).remove([`${jobId}.mp4`]);
}
