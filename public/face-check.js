// Tarayıcıda yüz sayımı (MediaPipe Face Detector). Model yüklenemezse null döner ve kontrol atlanır.
const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detectorPromise;

function getDetector() {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import(`${BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.55,
    });
  })().catch((err) => {
    console.warn('Yüz algılama yüklenemedi', err);
    return null;
  });
  return detectorPromise;
}

const countFaces = (detector, source) => detector.detect(source).detections.length;

function seek(video, time) {
  return new Promise((resolve) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = time;
  });
}

// Videodan eşit aralıklı kareler alıp her karedeki yüz sayısını döndürür.
export async function facesInVideo(video, samples = 5) {
  const detector = await getDetector();
  if (!detector) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  const counts = [];
  for (let i = 0; i < samples; i++) {
    await seek(video, (video.duration * (i + 0.5)) / samples);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    counts.push(countFaces(detector, canvas));
  }
  await seek(video, 0);
  return counts;
}

export async function facesInImage(img) {
  const detector = await getDetector();
  return detector ? countFaces(detector, img) : null;
}
