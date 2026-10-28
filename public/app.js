import { facesInImage, facesInVideo } from './face-check.js';

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'yuz-degistir-davet';

const state = {
  invite: safeGet(STORAGE_KEY) || '',
  config: null,
  provider: null,
  target: null, // { type: 'character', character } | { type: 'custom', photos: [Blob] }
  video: null,
  videoUrl: null,
  job: null,
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
}

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  window.scrollTo(0, 0);
}

function setError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...(options.headers || {}), 'x-invite-code': state.invite } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Hata (${res.status})`), { status: res.status });
  return body;
}

// ---------- 0. Davet ----------
$('#invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.invite = $('#invite-code').value.trim();
  try {
    await api('/api/login', { method: 'POST' });
    safeSet(STORAGE_KEY, state.invite);
    await boot();
  } catch (err) {
    setError($('#invite-error'), err.message);
  }
});

async function boot() {
  state.config = await api('/api/config');
  state.provider = state.config.defaultProvider;
  renderCharacters();
  renderProviders();
  show('characters');
}

// ---------- 1. Karakterler ----------
function renderCharacters() {
  const grid = $('#character-grid');
  grid.replaceChildren(
    ...state.config.characters.map((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card${c.available ? '' : ' unavailable'}`;
      btn.disabled = !c.available;
      btn.innerHTML = `
        <img alt="" loading="lazy" src="${c.available ? c.imageUrl : '/characters/placeholder.svg'}">
        ${c.available ? '' : '<span class="badge">portre bekleniyor</span>'}
        <div class="label"><strong></strong><small></small></div>`;
      btn.querySelector('strong').textContent = c.name;
      btn.querySelector('small').textContent = c.profile;
      btn.addEventListener('click', () => {
        state.target = { type: 'character', character: c };
        goToVideo();
      });
      return btn;
    }),
  );
}

function renderProviders() {
  const { providers } = state.config;
  $('#provider-box').hidden = providers.length < 2;
  const label = () => (providers.find((p) => p.name === state.provider)?.label || state.provider);
  $('#provider-label').textContent = label();
  $('#provider-options').replaceChildren(
    ...providers.map((p) => {
      const row = document.createElement('label');
      row.innerHTML = `<input type="radio" name="provider"> <span></span>`;
      row.querySelector('span').textContent = p.label;
      const radio = row.querySelector('input');
      radio.checked = p.name === state.provider;
      radio.addEventListener('change', () => {
        state.provider = p.name;
        $('#provider-label').textContent = label();
      });
      return row;
    }),
  );
}

$('#custom-person').addEventListener('click', () => {
  state.target = { type: 'custom', photos: [] };
  $('#photo-previews').replaceChildren();
  $('#consent').checked = false;
  setError($('#photo-error'), '');
  updatePhotosNext();
  show('photos');
});

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(b.dataset.back)));

// ---------- 1b. Kişi fotoğrafları ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Fotoğraf açılamadı.'));
    img.src = URL.createObjectURL(file);
  });
}

// HEIC vb. biçimleri JPEG'e çevirir ve boyutu küçültür.
function toJpeg(img, maxSide = 1536) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

$('#photo-input').addEventListener('change', async (e) => {
  const max = state.config.photos.max;
  const files = [...e.target.files].slice(0, max);
  e.target.value = '';
  setError($('#photo-error'), [...e.target.files].length > max ? `En fazla ${max} fotoğraf kullanılır.` : '');
  state.target.photos = [];
  const previews = $('#photo-previews');
  previews.replaceChildren();
  const problems = [];

  for (const file of files) {
    const fig = document.createElement('figure');
    previews.append(fig);
    try {
      const img = await loadImage(file);
      fig.append(img);
      const faces = await facesInImage(img);
      if (faces !== null && faces !== 1) {
        fig.className = 'bad';
        problems.push(faces === 0 ? 'Bir fotoğrafta yüz bulunamadı.' : 'Bir fotoğrafta birden fazla yüz var.');
        continue;
      }
      fig.className = 'ok';
      state.target.photos.push(await toJpeg(img));
    } catch (err) {
      fig.className = 'bad';
      problems.push(err.message);
    }
  }
  if (problems.length) setError($('#photo-error'), `${[...new Set(problems)].join(' ')} Kırmızı fotoğraflar kullanılmayacak.`);
  updatePhotosNext();
});

$('#consent').addEventListener('change', updatePhotosNext);

function updatePhotosNext() {
  $('#photos-next').disabled = !(state.target?.photos?.length && $('#consent').checked);
}

$('#photos-next').addEventListener('click', goToVideo);

// ---------- 2. Video ----------
function goToVideo() {
  const box = $('#selected-target');
  const t = state.target;
  const src = t.type === 'character' ? t.character.imageUrl : URL.createObjectURL(t.photos[0]);
  const title = t.type === 'character' ? t.character.name : 'Kendi fotoğrafların';
  const sub = t.type === 'character' ? t.character.profile : `${t.photos.length} fotoğraf`;
  box.innerHTML = '<img alt=""><div><strong></strong><br><small class="muted"></small></div>';
  box.querySelector('img').src = src;
  box.querySelector('strong').textContent = title;
  box.querySelector('small').textContent = sub;
  $('#screen-video .back').dataset.back = t.type === 'custom' ? 'photos' : 'characters';
  show('video');
}

for (const id of ['#video-camera', '#video-gallery']) {
  $(id).addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) checkVideo(file);
  });
}

// ---------- 3. Kontrol ----------
async function checkVideo(file) {
  state.video = file;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = URL.createObjectURL(file);

  const list = $('#checks');
  const item = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
    return li;
  };
  const mark = (li, cls, text) => {
    li.className = cls;
    if (text) li.textContent = text;
  };

  list.replaceChildren();
  setError($('#check-error'), '');
  $('#start').disabled = true;
  show('check');

  const video = $('#preview');
  video.src = state.videoUrl;
  const durationLi = item('Süre kontrol ediliyor…');
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('Video açılamadı. Başka bir video deneyin.'));
      video.load();
    });
  } catch (err) {
    mark(durationLi, 'bad', err.message);
    return;
  }

  const { minSeconds, maxSeconds } = state.config.video;
  const d = video.duration;
  if (!Number.isFinite(d)) {
    mark(durationLi, 'warn', 'Süre okunamadı; sunucu kontrol edecek.');
  } else if (d > maxSeconds) {
    mark(durationLi, 'bad', `Video ${d.toFixed(1)} sn. En fazla 10 saniye olmalı.`);
    setError($('#check-error'), 'Daha kısa bir video çekin ya da galeriden kırpın.');
    return;
  } else if (d < minSeconds) {
    mark(durationLi, 'bad', `Video ${d.toFixed(1)} sn. 5–10 saniye olmalı.`);
    return;
  } else {
    mark(durationLi, 'ok', `Süre: ${d.toFixed(1)} sn`);
  }

  const faceLi = item('Yüz aranıyor…');
  const counts = Number.isFinite(d) ? await facesInVideo(video) : null;
  if (counts === null) {
    mark(faceLi, 'warn', 'Yüz kontrolü bu cihazda yapılamadı.');
  } else if (counts.some((n) => n > 1)) {
    mark(faceLi, 'bad', 'Karede birden fazla kişi var. Tek kişiyle çekin.');
    return;
  } else if (counts.filter((n) => n === 1).length < counts.length - 1) {
    mark(faceLi, 'bad', 'Yüz her karede görünmüyor. Kameraya dönük çekin, eller yüzü kapatmasın.');
    return;
  } else {
    mark(faceLi, 'ok', 'Tek yüz, net görünüyor');
  }

  $('#start').disabled = false;
}

// ---------- 4. İşleme ----------
$('#start').addEventListener('click', startJob);
$('#retry').addEventListener('click', () => show('video'));

const STEP_ORDER = ['upload', 'preparing', 'generating', 'finishing'];
const STATUS_TO_STEP = {
  queued: 'preparing', preparing: 'preparing', uploading: 'generating',
  generating: 'generating', downloading: 'finishing', finishing: 'finishing',
};

function setStep(step) {
  const idx = STEP_ORDER.indexOf(step);
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step);
    li.className = i < idx ? 'done' : i === idx ? 'active' : '';
  });
}

let timer;
function startTimer() {
  const t0 = Date.now();
  clearInterval(timer);
  $('#elapsed').textContent = '0';
  timer = setInterval(() => ($('#elapsed').textContent = Math.floor((Date.now() - t0) / 1000)), 250);
}

function upload(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.setRequestHeader('x-invite-code', state.invite);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('#upload-bar').style.width = `${(e.loaded / e.total) * 100}%`;
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(body) : reject(new Error(body.error || `Hata (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Bağlantı hatası. İnternetini kontrol et.'));
    xhr.send(form);
  });
}

async function startJob() {
  const form = new FormData();
  form.append('video', state.video, state.video.name || 'video.mp4');
  form.append('provider', state.provider);
  if (state.target.type === 'character') {
    form.append('characterId', state.target.character.id);
  } else {
    state.target.photos.forEach((p, i) => form.append('photos', p, `foto-${i + 1}.jpg`));
    form.append('consent', 'true');
  }

  show('progress');
  setError($('#progress-error'), '');
  $('#retry').hidden = true;
  $('#progress-note').hidden = false;
  $('#upload-bar').style.width = '0';
  setStep('upload');
  startTimer();

  try {
    state.job = await upload(form);
    $('#upload-bar').parentElement.hidden = true;
    await poll(state.job.id);
  } catch (err) {
    clearInterval(timer);
    $('#progress-note').hidden = true;
    setError($('#progress-error'), err.message);
    $('#retry').hidden = false;
  } finally {
    $('#upload-bar').parentElement.hidden = false;
  }
}

async function poll(id) {
  for (;;) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === 'failed') throw new Error(`Dönüştürme başarısız: ${job.error}`);
    if (job.status === 'done') return showResult(job);
    setStep(STATUS_TO_STEP[job.status] || 'generating');
    if (job.queuePosition > 0) $('#progress-note').textContent = `Sırada ${job.queuePosition}. sıradasın…`;
    else $('#progress-note').textContent = 'Yaklaşık 1 dakika sürer. Bu sayfayı kapatma.';
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------- 5. Sonuç ----------
function showResult(job) {
  clearInterval(timer);
  state.job = job;
  const video = $('#result');
  video.src = job.resultUrl;
  const dl = job.resultUrl.startsWith('/') ? `${job.resultUrl}?download=1` : job.resultUrl;
  $('#download').href = dl;
  $('#result-meta').textContent = `${job.elapsedSeconds} saniyede hazırlandı`;
  $('#share').hidden = !navigator.canShare;
  show('result');
}

$('#share').addEventListener('click', async () => {
  try {
    const blob = await (await fetch(state.job.resultUrl)).blob();
    const file = new File([blob], 'donusum.mp4', { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else window.location.href = $('#download').href;
  } catch (err) {
    if (err.name !== 'AbortError') alert('Paylaşılamadı, “İndir” ile kaydedip paylaşabilirsin.');
  }
});

$('#again').addEventListener('click', () => show('characters'));

// ---------- Başlangıç ----------
if (state.invite) {
  boot().catch((err) => {
    if (err.status === 401) safeSet(STORAGE_KEY, null);
    $('#invite-code').value = state.invite;
    show('invite');
  });
} else {
  show('invite');
}
