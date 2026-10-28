import { spawn } from 'node:child_process';
import { config } from './config.js';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} çıkış kodu ${code}: ${err.slice(-500)}`)),
    );
  });
}

export async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(out);
  const video = info.streams.find((s) => s.codec_type === 'video');
  return {
    duration: Number(info.format?.duration || video?.duration || 0),
    hasVideo: Boolean(video),
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
    width: video?.width,
    height: video?.height,
  };
}

// Telefonlardan gelen MOV/HEVC/WebM kayıtlarını servislerin kabul ettiği H.264 MP4'e çevirir.
// Döndürme bilgisi ffmpeg tarafından otomatik uygulanır; dik video dik kalır.
export function normalizeVideo(input, output) {
  return run('ffmpeg', [
    '-y', '-v', 'error', '-i', input,
    '-t', String(config.video.maxSeconds),
    '-vf', "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    output,
  ]);
}

// Sonuç videosuna köşede "AI" işareti ekler. Servis sesi korumadıysa orijinal sesi geri koyar.
export async function finalizeVideo({ generated, original, output }) {
  const gen = await probe(generated);
  const orig = await probe(original);
  const reattachAudio = !gen.hasAudio && orig.hasAudio;

  const args = ['-y', '-v', 'error', '-i', generated, '-i', config.watermarkPath];
  if (reattachAudio) args.push('-i', original);
  args.push(
    '-filter_complex',
    // İşaret video genişliğinin ~%8'i kadar, sağ alt köşede
    '[1:v][0:v]scale2ref=w=oh*mdar:h=ih*0.05[wm][base];[base][wm]overlay=W-w-W*0.03:H-h-H*0.03[v]',
    '-map', '[v]',
    '-map', reattachAudio ? '2:a:0' : '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    output,
  );
  await run('ffmpeg', args);
  return { reattachedAudio: reattachAudio };
}
