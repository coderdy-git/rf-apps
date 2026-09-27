// ============ PENDAFTARAN SERVICE WORKER ============

/**
 * Daftarkan service worker dengan versi dari commit terakhir.
 *
 * Versi ikut di URL pendaftaran, dan sw.js memakainya sebagai nama
 * cache. Jadi setiap deploy menghasilkan cache baru, dan cache lama
 * dibuang otomatis — tanpa ini, perangkat user terus menyajikan aset
 * lama sampai mereka hard refresh manual.
 *
 * Kalau versinya belum diketahui, tunggu sebentar — lebih baik
 * mendaftar dengan versi yang benar daripada mendaftar buru-buru
 * lalu cache-nya tidak pernah diperbarui.
 */
async function daftarkanServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    let versi = 'dev';
    try {
        const response = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const hasil = await response.json();
        if (hasil.commit) versi = hasil.commit;
    } catch {
        // Gagal ambil versi bukan alasan untuk tidak mendaftar.
        // Cache 'dev' tetap berfungsi, hanya perlu dibersihkan manual.
    }

    try {
        await navigator.serviceWorker.register(`sw.js?v=${versi}`, { scope: './' });
    } catch (error) {
        // Kegagalan di sini tidak menghalangi aplikasi dipakai —
        // hanya berarti mode offline tidak aktif. Tetap dicatat
        // karena tanpa ini sulit mendiagnosa kenapa offline
        // tidak jalan di perangkat tertentu.
        console.warn('Service worker gagal terdaftar:', error);
    }
}

window.addEventListener('load', daftarkanServiceWorker);

// Tombol pemasangan muncul saat browser menawarkan install.
// Chrome menampilkan ini otomatis; kita simpan eventnya supaya bisa
// memicu lewat tombol sendiri di halaman Pengaturan.
let promptPasang = null;

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptPasang = event;
    tampilkanTombolPasang(true);
});

window.addEventListener('appinstalled', () => {
    promptPasang = null;
    tampilkanTombolPasang(false);
    if (typeof showToast === 'function') {
        showToast('Aplikasi berhasil dipasang', 'success');
    }
});

function tampilkanTombolPasang(tampil) {
    const tombol = document.getElementById('tombolPasang');
    if (tombol) tombol.classList.toggle('hidden', !tampil);
}

async function pasangAplikasi() {
    if (!promptPasang) return;

    promptPasang.prompt();
    const { outcome } = await promptPasang.userChoice;

    if (outcome === 'accepted') {
        promptPasang = null;
        tampilkanTombolPasang(false);
    }
}
