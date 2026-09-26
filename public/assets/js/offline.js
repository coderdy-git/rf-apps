// ============ MODE OFFLINE ============
//
// Menyimpan transaksi yang dibuat saat tidak ada internet, lalu
// mengirimnya saat koneksi kembali.
//
// Bergantung pada app.js (apiFetch, showToast) dan auth.js (currentUser).

const DB_NAMA = 'rf-offline';
const DB_VERSI = 1;
const TOKO = 'antrean';

let dbTerbuka = null;

// ---------- IndexedDB ----------

function bukaDb() {
    if (dbTerbuka) return Promise.resolve(dbTerbuka);

    return new Promise((selesai, gagal) => {
        const permintaan = indexedDB.open(DB_NAMA, DB_VERSI);

        permintaan.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(TOKO)) {
                const toko = db.createObjectStore(TOKO, { keyPath: 'id' });
                // Diurutkan waktu dibuat supaya terkirim sesuai urutan input
                toko.createIndex('dibuat', 'dibuat');
            }
        };

        permintaan.onsuccess = () => {
            dbTerbuka = permintaan.result;
            selesai(dbTerbuka);
        };

        permintaan.onerror = () => gagal(permintaan.error);
    });
}

async function simpanKeAntrean(item) {
    const db = await bukaDb();

    return new Promise((selesai, gagal) => {
        const tx = db.transaction(TOKO, 'readwrite');
        tx.objectStore(TOKO).put(item);
        tx.oncomplete = () => selesai(item);
        tx.onerror = () => gagal(tx.error);
    });
}

async function ambilAntrean() {
    const db = await bukaDb();

    return new Promise((selesai, gagal) => {
        const tx = db.transaction(TOKO, 'readonly');
        const permintaan = tx.objectStore(TOKO).index('dibuat').getAll();
        permintaan.onsuccess = () => selesai(permintaan.result ?? []);
        permintaan.onerror = () => gagal(permintaan.error);
    });
}

async function hapusDariAntrean(id) {
    const db = await bukaDb();

    return new Promise((selesai, gagal) => {
        const tx = db.transaction(TOKO, 'readwrite');
        tx.objectStore(TOKO).delete(id);
        tx.oncomplete = () => selesai();
        tx.onerror = () => gagal(tx.error);
    });
}

async function jumlahAntrean() {
    try {
        return (await ambilAntrean()).length;
    } catch {
        return 0;
    }
}

// ---------- Kirim atau antre ----------

/**
 * Kirim permintaan tulis ke server. Kalau sedang offline atau
 * jaringannya gagal, simpan ke antrean dan kembalikan hasil tiruan
 * supaya UI bisa lanjut tanpa menunggu.
 *
 * $konteks dipakai saat pengiriman ulang: berisi info yang dibutuhkan
 * untuk memeriksa apakah datanya masih valid (lihat periksaKonflik).
 */
async function kirimAtauAntre(path, method, body, konteks = {}) {
    if (sedangOnline()) {
        try {
            const respons = await apiFetch(path, {
                method,
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const hasil = await respons.json();

            // Server menolak karena aturan bisnis (bukan karena jaringan) —
            // ini jawaban final, jangan diantre.
            if (respons.status < 500) return hasil;

            // 5xx kemungkinan masalah sementara, coba lagi nanti
            throw new Error('Server error ' + respons.status);
        } catch (error) {
            // Jaringan putus di tengah jalan — lanjut ke antrean di bawah
            console.warn('Gagal kirim, masuk antrean:', error);
        }
    }

    const item = {
        id: `antre-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        path,
        method,
        body,
        konteks,
        dibuat: Date.now(),
    };

    await simpanKeAntrean(item);
    perbaruiPenandaAntrean();

    return {
        success: true,
        offline: true,
        message: 'Tersimpan offline, akan terkirim otomatis',
    };
}

// ---------- Status koneksi ----------

function sedangOnline() {
    return navigator.onLine;
}

window.addEventListener('online', () => {
    perbaruiPenandaKoneksi();
    kirimAntrean();
});

window.addEventListener('offline', perbaruiPenandaKoneksi);

function perbaruiPenandaKoneksi() {
    const el = document.getElementById('penandaKoneksi');
    if (!el) return;

    if (sedangOnline()) {
        el.classList.add('hidden');
    } else {
        el.classList.remove('hidden');
    }
    perbaruiPenandaAntrean();
}

// ---------- Sinkronisasi ----------

let sedangSinkron = false;

async function kirimAntrean() {
    if (sedangSinkron || !sedangOnline()) return;

    const antrean = await ambilAntrean();
    if (!antrean.length) return;

    sedangSinkron = true;
    let berhasil = 0;
    let ditahan = 0;

    try {
        for (const item of antrean) {
            // Cek dulu apakah data di server masih seperti saat dicatat.
            // Kalau sudah berubah, transaksi ini tidak boleh dikirim —
            // piutangnya mungkin sudah lunas lewat perangkat lain.
            const aman = await periksaKonflik(item);

            if (!aman) {
                ditahan++;
                await tandaiBentrok(item.id);
                continue;
            }

            try {
                const respons = await apiFetch(item.path, {
                    method: item.method,
                    body: item.body === undefined ? undefined : JSON.stringify(item.body),
                });
                const hasil = await respons.json();

                if (hasil.success) {
                    await hapusDariAntrean(item.id);
                    berhasil++;
                } else {
                    // Ditolak server karena aturan bisnis — tidak akan
                    // berhasil kalau dicoba lagi. Tandai untuk ditinjau.
                    ditahan++;
                    await tandaiBentrok(item.id, hasil.message);
                }
            } catch (error) {
                // Jaringan putus lagi — hentikan, sisanya dicoba nanti
                console.warn('Sinkronisasi terhenti:', error);
                break;
            }
        }
    } finally {
        sedangSinkron = false;
    }

    if (berhasil > 0) {
        showToast(`${berhasil} transaksi offline berhasil terkirim`, 'success');
        // Muat ulang layar yang sedang tampil supaya angkanya sinkron
        muatUlangLayarAktif();
    }

    if (ditahan > 0) {
        showToast(`${ditahan} transaksi ditahan karena data sudah berubah`, 'error');
    }

    perbaruiPenandaAntrean();
}

/**
 * Periksa apakah transaksi yang diantre masih aman dikirim.
 *
 * Untuk pembayaran: pastikan piutang yang mau dilunasi masih terbuka.
 * Kalau ada yang sudah lunas, transaksi ini dibatalkan.
 */
async function periksaKonflik(item) {
    if (!item.konteks || !item.konteks.cekPiutangTerbuka) return true;

    const { contactId, receivableIds } = item.konteks.cekPiutangTerbuka;
    if (!receivableIds || !receivableIds.length) return true;

    try {
        const respons = await apiFetch('/contacts/' + contactId, { method: 'GET' });
        const hasil = await respons.json();
        if (!hasil.success) return true;

        const masihTerbuka = new Set((hasil.data.receivables ?? []).map(r => r.id));

        // Aman hanya kalau SEMUA piutang yang mau dibayar masih terbuka
        return receivableIds.every(id => masihTerbuka.has(id));
    } catch {
        // Tidak bisa memastikan — anggap belum aman, tahan dulu
        return false;
    }
}

async function tandaiBentrok(id, alasan = null) {
    const db = await bukaDb();

    return new Promise((selesai) => {
        const tx = db.transaction(TOKO, 'readwrite');
        const toko = tx.objectStore(TOKO);
        const ambil = toko.get(id);

        ambil.onsuccess = () => {
            const item = ambil.result;
            if (item) {
                item.bentrok = true;
                item.alasan = alasan ?? 'Data sudah berubah di server';
                toko.put(item);
            }
        };

        tx.oncomplete = () => selesai();
        tx.onerror = () => selesai();
    });
}

// ---------- Penanda antrean ----------

async function perbaruiPenandaAntrean() {
    const el = document.getElementById('penandaAntrean');
    if (!el) return;

    const jumlah = await jumlahAntrean();

    if (jumlah === 0) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    el.querySelector('[data-jumlah]').textContent =
        jumlah === 1 ? '1 transaksi menunggu' : `${jumlah} transaksi menunggu`;
}

// ---------- Muat ulang layar ----------

/**
 * Fungsi yang mendaftar untuk dipanggil setelah antrean terkirim.
 *
 * piutang.js mendaftarkan fungsinya sendiri lewat daftarMuatUlang().
 * Cara ini dipakai supaya offline.js tidak perlu mengintip variabel
 * internal piutang.js — kalau piutang.js belum dimuat, tidak ada yang
 * terdaftar dan tidak ada yang error.
 */
const pemuatUlang = new Set();

function daftarMuatUlang(fn) {
    pemuatUlang.add(fn);
}

function muatUlangLayarAktif() {
    // Panggil ulang pemuatan data untuk layar yang sedang tampil,
    // supaya angka di layar mencerminkan data terbaru dari server.
    for (const fn of pemuatUlang) {
        try {
            fn();
        } catch (error) {
            console.warn('Muat ulang gagal:', error);
        }
    }
}

// ---------- Layar tinjauan antrean ----------

async function renderAntreanScreen() {
    const list = document.getElementById('antreanList');
    if (!list) return;

    const antrean = await ambilAntrean();

    if (!antrean.length) {
        list.innerHTML = `
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <p class="text-gray-500 text-center">Tidak ada transaksi tertunda</p>
            </div>
        `;
        document.getElementById('tombolKirimUlang')?.classList.add('hidden');
        return;
    }

    document.getElementById('tombolKirimUlang')?.classList.remove('hidden');
    list.innerHTML = antrean.map(renderAntreanItem).join('');

    list.querySelectorAll('[data-hapus]').forEach(btn => {
        btn.addEventListener('click', () => hapusAntreanManual(btn.dataset.hapus));
    });
}

function renderAntreanItem(item) {
    const waktu = new Date(item.dibuat).toLocaleString('id-ID', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const bentrok = item.bentrok
        ? `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
               <p class="text-xs text-red-700 font-medium">Bentrok</p>
               <p class="text-xs text-red-600 mt-1">${escapeHtml(item.alasan || 'Data sudah berubah di server')}</p>
           </div>`
        : '';

    return `
        <div class="bg-white rounded-xl shadow-sm p-4">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-gray-800">${escapeHtml(jelaskanAksi(item))}</p>
                    <p class="text-xs text-gray-500 mt-1">${waktu}</p>
                </div>
                <button data-hapus="${item.id}"
                        class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center flex-shrink-0"
                        aria-label="Hapus dari antrean">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </div>
            ${bentrok}
        </div>
    `;
}

// Terjemahkan path + method jadi kalimat yang bisa dimengerti
function jelaskanAksi(item) {
    const p = item.path;
    const m = item.method;

    if (p.endsWith('/payments') && m === 'POST') return 'Pembayaran piutang';
    if (p.startsWith('/payments/') && m === 'DELETE') return 'Pembatalan pembayaran';
    if (p.endsWith('/deposits') && m === 'POST') return 'Setoran deposit';
    if (p.startsWith('/deposits/') && m === 'DELETE') return 'Pembatalan setoran';
    if (p.startsWith('/receivables/') && m === 'DELETE') return 'Pembatalan piutang';
    if (p.includes('/receivables')) return 'Perubahan piutang';
    if (p.includes('/contacts')) return 'Perubahan kontak';

    return 'Transaksi';
}

async function hapusAntreanManual(id) {
    await hapusDariAntrean(id);
    showToast('Transaksi dihapus dari antrean', 'success');
    await renderAntreanScreen();
    perbaruiPenandaAntrean();
}

async function kirimAntreanSekarang() {
    if (!sedangOnline()) {
        showToast('Masih tidak ada koneksi', 'error');
        return;
    }

    // Bersihkan tanda bentrok dulu supaya dicoba ulang
    const antrean = await ambilAntrean();
    for (const item of antrean) {
        if (item.bentrok) {
            const db = await bukaDb();
            await new Promise((selesai) => {
                const tx = db.transaction(TOKO, 'readwrite');
                const toko = tx.objectStore(TOKO);
                const ambil = toko.get(item.id);
                ambil.onsuccess = () => {
                    const d = ambil.result;
                    if (d) { delete d.bentrok; delete d.alasan; toko.put(d); }
                };
                tx.oncomplete = selesai;
            });
        }
    }

    await kirimAntrean();
    await renderAntreanScreen();
}

// ---------- Inisialisasi ----------

document.addEventListener('DOMContentLoaded', () => {
    perbaruiPenandaKoneksi();
    perbaruiPenandaAntrean();

    // Coba kirim antrean yang tersisa dari sesi sebelumnya
    setTimeout(kirimAntrean, 2000);
});
