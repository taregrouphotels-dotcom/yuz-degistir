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
  const rotation = Number(
    video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0,
  );
  return {
    duration: Number(info.format?.duration || video?.duration || 0),
    hasVideo: Boolean(video),
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
    codec: video?.codec_name,
    rotation,
    width: video?.width,
    height: video?.height,
  };
}

// Render'ın küçük sunucularında bellek ve işlemci kısıtlı; ffmpeg en hızlı ayarla ve 2 iş parçacığıyla çalışır.
const ENCODE = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-threads', '2'];

// Telefon videosunu servise uygun MP4'e çevirir.
// Döndürme bilgisi olmayan H.264/HEVC videolar yeniden kodlanmadan aktarılır. Servis döndürme
// bilgisini dikkate almadığı için döndürülmüş (çoğu telefonda dik) videolar ve diğer biçimler
// en uzun kenarı 1280 olacak şekilde yeniden kodlanır; ffmpeg döndürmeyi bu sırada uygular.
export async function normalizeVideo(input, output) {
  const info = await probe(input);
  const longSide = Math.max(info.width || 0, info.height || 0);
  if (info.rotation % 360 === 0 && ['h264', 'hevc'].includes(info.codec) && longSide <= 3840) {
    const tag = info.codec === 'hevc' ? ['-tag:v', 'hvc1'] : [];
    await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', ...tag, '-movflags', '+faststart', output]);
    return { reencoded: false };
  }
  await run('ffmpeg', [
    '-y', '-v', 'error', '-threads', '2', '-i', input,
    '-t', String(config.video.maxSeconds),
    '-vf', "scale=w='if(gt(iw,ih),min(1280,iw),-2)':h='if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2",
    ...ENCODE,
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    output,
  ]);
  return { reencoded: true };
}

// Sonuç videosuna köşede "AI" işareti ekler. Servis sesi korumadıysa orijinal sesi geri koyar.
export async function finalizeVideo({ generated, original, output }) {
  const gen = await probe(generated);
  const orig = await probe(original);
  const reattachAudio = !gen.hasAudio && orig.hasAudio;

  const args = ['-y', '-v', 'error', '-threads', '2', '-i', generated, '-i', config.watermarkPath];
  if (reattachAudio) args.push('-i', original);
  args.push(
    '-filter_complex',
    // İşaret video genişliğinin ~%8'i kadar, sağ alt köşede
    '[1:v][0:v]scale2ref=w=oh*mdar:h=ih*0.05[wm][base];[base][wm]overlay=W-w-W*0.03:H-h-H*0.03[v]',
    '-map', '[v]',
    '-map', reattachAudio ? '2:a:0' : '0:a?',
    ...ENCODE,
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    output,
  );
  await run('ffmpeg', args);
  return { reattachedAudio: reattachAudio };
}
