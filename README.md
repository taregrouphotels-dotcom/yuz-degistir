# Yüz Değiştir — ilk demo

Kullanıcının çektiği 5–10 saniyelik videoyu seçilen karaktere yaklaşık 1 dakikada aktaran,
telefon tarayıcısında çalışan web uygulaması. Kapsam ve başarı kriterleri için
"Yüz Değiştirme Uygulaması — İlk Demo Tanımı" belgesine bakın.

## Telefondan yayına alma (bilgisayar gerekmez)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/taregrouphotels-dotcom/elisagidaanime/tree/ccr-b2f4d2de-te8ujb)

1. Düğmeye dokun, **GitHub ile** Render'a giriş yap; Render GitHub'a erişim isterse bu depoya izin ver.
2. Açılan formda iki alanı doldur: `INVITE_CODES` (arkadaşlara vereceğin kod) ve `PRUNA_API_KEY`.
   `REPLICATE_API_TOKEN` boş kalabilir.
3. **Deploy**'a bas. Birkaç dakika sonra `https://yuz-degistir-xxxx.onrender.com` adresi çalışır.

Ücretsiz planda sunucu 15 dakika kullanılmazsa uyur; ilk açılış ~1 dakika sürer ve
saklanan sonuçlar silinir. Sürekli açık kalması için Render'da planı **Starter**'a yükseltmek yeterli.

## Akış

1. Davet kodu ile giriş (uygulama herkese açık değil).
2. 10 test karakterinden biri **ya da** kişinin 1–4 fotoğrafı (izin onayı zorunlu).
3. Çekim kuralları ekranı → kamerayla çek ya da galeriden seç.
4. Tarayıcıda kontrol: süre ≤ 10 sn, her karede tek yüz (MediaPipe). Uymazsa nedeni söylenir.
   Sunucu süreyi `ffprobe` ile tekrar kontrol eder.
5. Sunucu videoyu H.264 MP4'e çevirir, seçilen servise gönderir, ilerlemeyi gösterir.
6. Sonuca sağ alt köşede **"AI"** işareti eklenir; servis sesi korumadıysa orijinal ses ffmpeg ile geri konur.
7. Sonuç oynatılır; indirilebilir ya da paylaşım menüsüyle WhatsApp/Instagram'a gönderilebilir.

## Kurulum

Gerekenler: Node.js 20+, `ffmpeg` ve `ffprobe`.

```bash
npm install
cp .env.example .env     # INVITE_CODES ve PRUNA_API_KEY'i doldurun
npm start                # http://localhost:3000
```

API anahtarı olmadan akışı denemek için `PROVIDER=mock` kullanın (video değiştirilmeden geri döner).

Telefonda denemek için sunucunun HTTPS üzerinden erişilebilir olması gerekir (kamera ve paylaşım menüsü
HTTPS ister). Hızlı yol: `npx cloudflared tunnel --url http://localhost:3000` ya da Render/Railway/Fly gibi
ffmpeg kurulabilen bir sunucuya yükleme. Açılan sayfada "Ana ekrana ekle" ile uygulama gibi kullanılır.

## Servisler

| `PROVIDER` | Servis | Gerekli ayar |
| --- | --- | --- |
| `pruna` | Pruna P-Video-Replace (önerilen; 1–4 referans görsel, ses korunur) | `PRUNA_API_KEY`, `PRUNA_RESOLUTION` (720p/1080p) |
| `wan` | Wan 2.2 Animate – Replace (Replicate) | `REPLICATE_API_TOKEN`; `WAN_VIDEO_FIELD` / `WAN_IMAGE_FIELD` alan adlarını Replicate model sayfasının API sekmesinden doğrulayın |
| `mock` | Deneme, dönüşüm yok | — |

Birden fazla servis ayarlıysa karakter ekranının altındaki "Servis" kutusundan seçilebilir.
Servisin kendi güvenlik filtresi kapatılmaz.

## Karakter portreleri

`characters/characters.json` 10 test profilini (demo tanımındaki tablo) içerir. Portreler
`public/characters/` altına JSON'daki dosya adlarıyla konur; portresi olmayan karakter uygulamada
"portre bekleniyor" görünür. Portre kuralları: `public/characters/README.md`.

## Portre üretimi

```bash
npm run portraits -- --variants 3
```

Her karakter için Pruna p-image ile 3 aday üretir (`reports/portraits/`, görsel başına ~0,005 $).
Seçilen aday `public/characters/` altına JSON'daki adla kopyalanır.

## İki servisin karşılaştırılması

4 test videosunu `test-videos/` klasörüne koyun, iki servisin anahtarını `.env`'e yazın:

```bash
npm run compare -- --providers pruna,wan --characters all
```

`reports/<zaman>/` altında her video × karakter × servis için sonuç videosu, süreler ve
1 dakika altı oranı, yan yana izleme sayfası (`index.html`) ve puanlama sütunları boş bir
`report.csv` oluşur. Titreme, dudak uyumu ve benzerlik puanları izlenerek elle girilir.

## Gizlilik ve saklama

- Kişi fotoğrafları iş bitince hemen silinir.
- Videolar ve sonuçlar `RETENTION_HOURS` (varsayılan 24 saat) sonra silinir.
- Supabase ayarlıysa (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`) sonuçlar
  Supabase Storage'a özel (private) bir kovaya yüklenir ve süreli imzalı bağlantıyla verilir;
  kovayı önceden oluşturun. Ayarlı değilse sonuçlar sunucunun diskinden servis edilir.
- API anahtarları yalnızca sunucuda durur.

## Bilinen sınırlar

- İş kuyruğu bellekte tutulur; sunucu yeniden başlarsa süren işler kaybolur (demo için yeterli).
- Pruna en fazla 4 referans görsel alır (belgede 4–5 yazıyor); Wan yalnızca ilk fotoğrafı kullanır.
- Yüz kontrolü tarayıcıda yapılır; model yüklenemezse uyarı verilip atlanır.

## Dosyalar

```
server/index.js        HTTP API (davet kodu, yükleme, iş durumu, sonuç)
server/jobs.js         iş kuyruğu, süre ölçümü, temizlik
server/media.js        ffprobe kontrolü, normalize, AI işareti + ses geri ekleme
server/providers/      pruna, wan (Replicate), mock
server/storage.js      yerel disk / Supabase Storage
public/                mobil web uygulaması (PWA)
scripts/compare.js     servis karşılaştırma aracı
```
