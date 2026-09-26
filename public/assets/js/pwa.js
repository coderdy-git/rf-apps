// ============ PENDAFTARAN SERVICE WORKER ============

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('sw.js', { scope: './' })
            .catch((error) => {
                // Kegagalan di sini tidak menghalangi aplikasi dipakai —
                // hanya berarti mode offline tidak aktif. Tetap dicatat
                // karena tanpa ini sulit mendiagnosa kenapa offline
                // tidak jalan di perangkat tertentu.
                console.warn('Service worker gagal terdaftar:', error);
            });
    });
}

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
