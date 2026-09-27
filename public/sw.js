/**
 * Service worker RF Apps.
 *
 * Tiga jenis request diperlakukan berbeda:
 *
 * 1. API (/api/*)   — tidak pernah di-cache. Data keuangan harus selalu
 *                     dari server; menyajikan saldo basi jauh lebih
 *                     berbahaya daripada gagal memuat.
 * 2. Aset lokal      — cache dulu, perbarui di latar belakang.
 * 3. CDN             — sama, tapi cache-nya lebih panjang karena versinya
 *                     tidak berubah.
 */

/**
 * Versi cache diambil dari parameter di URL pendaftaran service worker
 * (lihat assets/js/pwa.js), yang isinya commit terakhir aplikasi.
 *
 * Dengan begitu setiap deploy menghasilkan nama cache yang baru, dan
 * cache lama otomatis dibuang di event activate. Sebelumnya versi ini
 * ditulis manual dan tidak pernah berubah, sehingga perangkat user
 * terus menyajikan aset lama setelah aplikasi diperbarui.
 */
const VERSI = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_ASET = `rf-aset-${VERSI}`;
const CACHE_CDN = `rf-cdn-${VERSI}`;

// Aset inti yang harus ada supaya aplikasi bisa dibuka saat offline
const ASET_INTI = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/js/auth.js',
    './assets/js/app.js',
    './assets/js/piutang.js',
    './assets/js/offline.js',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
];

// Dipakai sebagai pengganti kalau halaman diminta saat offline
// dan belum pernah tersimpan di cache.
const HALAMAN_OFFLINE = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RF Apps — Offline</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,sans-serif;background:#f9fafb;color:#374151;text-align:center;padding:24px}
  .k{max-width:320px}
  h1{font-size:1.25rem;margin:0 0 8px}
  p{margin:0;color:#6b7280;font-size:.9rem;line-height:1.5}
</style></head>
<body><div class="k">
<h1>Aplikasi belum siap offline</h1>
<p>Buka aplikasi sekali saat ada internet supaya asetnya tersimpan.
Transaksi yang sudah kamu catat tetap aman dan akan terkirim otomatis.</p>
</div></body></html>`;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_ASET)
            // addAll gagal total kalau satu file tidak ada. Daftar ini
            // dikurasi supaya tidak ada yang bisa menggagalkan instalasi.
            .then((cache) => cache.addAll(ASET_INTI))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((nama) => Promise.all(
                nama
                    .filter((n) => n.startsWith('rf-') && n !== CACHE_ASET && n !== CACHE_CDN)
                    .map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Hanya tangani GET. Permintaan tulis tidak boleh di-cache.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // 1. API — selalu ke jaringan, tidak pernah di-cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request));
        return;
    }

    // 2. CDN — cache dulu, perbarui di latar belakang
    if (url.origin !== self.location.origin) {
        event.respondWith(cacheDuluLaluPerbarui(request, CACHE_CDN));
        return;
    }

    // 3. Aset lokal — untuk navigasi, coba jaringan dulu supaya
    //    halaman terbaru yang tampil; kalau gagal, pakai cache.
    if (request.mode === 'navigate') {
        event.respondWith(jaringanDuluLaluCache(request));
        return;
    }

    event.respondWith(cacheDuluLaluPerbarui(request, CACHE_ASET));
});

/**
 * Sajikan dari cache segera, lalu perbarui di latar belakang.
 * Hasilnya cepat, tapi tetap ter-update pada pemuatan berikutnya.
 */
async function cacheDuluLaluPerbarui(request, namaCache) {
    const cache = await caches.open(namaCache);
    const tersimpan = await cache.match(request);

    const dariJaringan = fetch(request)
        .then((respons) => {
            // Simpan hanya respons yang benar-benar berhasil
            if (respons && respons.status === 200) {
                cache.put(request, respons.clone());
            }
            return respons;
        })
        .catch(() => null);

    if (tersimpan) return tersimpan;

    const respons = await dariJaringan;
    if (respons) return respons;

    throw new Error('Tidak ada di cache dan jaringan gagal');
}

/**
 * Untuk navigasi: pakai jaringan dulu supaya user mendapat versi
 * terbaru, dan simpan salinannya untuk dibuka saat offline.
 */
async function jaringanDuluLaluCache(request) {
    try {
        const respons = await fetch(request);
        if (respons && respons.status === 200) {
            const cache = await caches.open(CACHE_ASET);
            cache.put(request, respons.clone());
        }
        return respons;
    } catch (error) {
        const cache = await caches.open(CACHE_ASET);
        const tersimpan = await cache.match(request) || await cache.match('./index.html');

        if (tersimpan) return tersimpan;

        return new Response(HALAMAN_OFFLINE, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }
}
