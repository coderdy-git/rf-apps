// ============ BUKU PIUTANG ============
//
// Bergantung pada app.js (apiFetch, showToast, setButtonLoading) dan
// auth.js (currentUser). Dimuat setelah keduanya.

let currentContact = null;
let currentReceivables = [];
let currentDeposits = [];
let currentPayments = [];

// ---------- Util ----------

// Format angka jadi rupiah: 1500000 -> "Rp 1.500.000"
function rupiah(value) {
    const n = Number(value) || 0;
    return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

// Format tanggal "2026-09-26" -> "26 Sep 2026"
function tanggalSingkat(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Ambil angka murni dari input yang mungkin berisi titik pemisah
function angkaDari(teks) {
    const bersih = String(teks ?? '').replace(/[^\d]/g, '');
    return bersih === '' ? 0 : Number(bersih);
}

// Ubah angka jadi teks berpemisah ribuan: 1500000 -> "1.500.000"
function formatRibuan(angka) {
    const n = Number(angka) || 0;
    return n === 0 ? '' : n.toLocaleString('id-ID');
}

/**
 * Pasang pemisah ribuan otomatis pada sebuah input.
 *
 * Nilai diformat ulang setiap kali diketik, lalu kursor ditaruh kembali
 * di posisi yang benar. Tanpa menghitung ulang posisi kursor, mengetik
 * di tengah angka akan melompat ke akhir — karena panjang teks berubah
 * saat titik ditambahkan.
 */
function pasangPemisahRibuan(input) {
    if (!input) return;

    input.addEventListener('input', () => {
        const posisiLama = input.selectionStart;
        const digitSebelum = input.value.slice(0, posisiLama).replace(/[^\d]/g, '').length;

        input.value = formatRibuan(angkaDari(input.value));

        // Hitung ulang posisi kursor: maju sampai melewati sejumlah
        // digit yang sama seperti sebelum diformat.
        let posisiBaru = 0;
        let digitTerhitung = 0;
        while (posisiBaru < input.value.length && digitTerhitung < digitSebelum) {
            if (/\d/.test(input.value[posisiBaru])) digitTerhitung++;
            posisiBaru++;
        }
        input.setSelectionRange(posisiBaru, posisiBaru);
    });
}

// ---------- Modal ----------

function openModal(title, bodyHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;

    const modal = document.getElementById('modal');
    const panel = document.getElementById('modalPanel');

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Panel mulai dari posisi tergeser ke bawah, lalu digeser naik.
    // requestAnimationFrame menunggu browser sempat menggambar posisi
    // awal dulu — tanpa ini, transisinya tidak akan terlihat karena
    // kedua kelas berubah di frame yang sama.
    requestAnimationFrame(() => {
        panel.classList.remove('translate-y-full');
    });
}

function closeModal() {
    const modal = document.getElementById('modal');
    const panel = document.getElementById('modalPanel');

    panel.classList.add('translate-y-full');

    // Tunggu animasi selesai sebelum disembunyikan, supaya panelnya
    // terlihat turun ke bawah, bukan hilang mendadak.
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'modal') closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ---------- Daftar Kontak ----------

async function loadContacts() {
    const list = document.getElementById('contactList');

    list.innerHTML = loadingBlock('Memuat kontak...');

    try {
        const response = await apiFetch('/contacts', { method: 'GET' });
        const result = await response.json();

        if (!result.success) {
            list.innerHTML = errorBlock(result.message || 'Gagal memuat kontak');
            return;
        }

        if (!result.data.length) {
            list.innerHTML = emptyBlock('Belum ada kontak');
            return;
        }

        list.innerHTML = result.data.map(renderContactRow).join('');
    } catch (error) {
        console.error('loadContacts:', error);
        list.innerHTML = errorBlock('Gagal memuat kontak');
    }
}

function renderContactRow(contact) {
    const piutang = Number(contact.outstanding_total) || 0;
    const deposit = Number(contact.deposit_balance) || 0;

    // Warna beda kalau masih ada piutang — supaya yang perlu ditagih
    // langsung kelihatan saat menggulir daftar.
    const piutangClass = piutang > 0 ? 'text-red-600 font-semibold' : 'text-gray-400';
    const depositClass = deposit > 0 ? 'text-green-600 font-semibold' : 'text-gray-400';

    return `
        <button onclick="openContact('${contact.id}')"
                class="w-full text-left bg-white rounded-xl shadow-sm p-4 active:scale-[0.98] transition-transform">
            <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-gray-800 truncate">${escapeHtml(contact.name)}</span>
                <svg class="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
            </div>
            <div class="flex gap-6 text-sm">
                <div>
                    <span class="text-gray-500 text-xs block">Piutang</span>
                    <span class="${piutangClass}">${rupiah(piutang)}</span>
                </div>
                <div>
                    <span class="text-gray-500 text-xs block">Deposit</span>
                    <span class="${depositClass}">${rupiah(deposit)}</span>
                </div>
            </div>
        </button>
    `;
}

// ---------- Detail Kontak ----------

/**
 * Muat detail kontak dan segarkan kedua halaman sekaligus.
 *
 * Detail kontak dan halaman riwayat sama-sama di-render ulang, supaya
 * angka di keduanya selalu sinkron — kalau hanya satu yang di-render,
 * halaman lain masih menampilkan data sebelum transaksi terakhir.
 *
 * $returnTo hanya menentukan halaman mana yang ditampilkan setelah
 * selesai, bukan mana yang di-render.
 */
async function openContact(id, returnTo = 'contactDetailScreen') {
    showScreen(returnTo);

    const detailBody = document.getElementById('contactDetailBody');
    const historyBody = document.getElementById('contactHistoryBody');

    const activeBody = returnTo === 'contactHistoryScreen' ? historyBody : detailBody;
    activeBody.innerHTML = loadingBlock('Memuat detail...');

    if (returnTo === 'contactDetailScreen') {
        document.getElementById('contactDetailName').textContent = 'Memuat...';
    }

    try {
        // Kontak, deposit, dan pembayaran diambil bersamaan — ketiganya
        // independen, jadi tidak perlu menunggu satu selesai baru mulai.
        const [contactRes, depositRes, paymentRes] = await Promise.all([
            apiFetch('/contacts/' + id, { method: 'GET' }),
            apiFetch('/contacts/' + id + '/deposits', { method: 'GET' }),
            apiFetch('/contacts/' + id + '/payments', { method: 'GET' }),
        ]);

        const result = await contactRes.json();

        if (!result.success) {
            detailBody.innerHTML = errorBlock(result.message || 'Kontak tidak ditemukan');
            historyBody.innerHTML = errorBlock(result.message || 'Kontak tidak ditemukan');
            document.getElementById('contactDetailPhone').textContent = '';
            return;
        }

        const depositResult = await depositRes.json();
        const paymentResult = await paymentRes.json();

        currentContact = result.data.contact;
        currentReceivables = result.data.receivables ?? [];
        currentDeposits = depositResult.success ? (depositResult.data.history ?? []) : [];
        currentPayments = paymentResult.success ? (paymentResult.data ?? []) : [];

        // Header detail kontak
        document.getElementById('contactDetailName').textContent = currentContact.name;
        document.getElementById('contactDetailPhone').textContent = currentContact.phone || '';

        // Render detail kontak — piutang aktif di sini yang perlu
        // ter-update setelah transaksi.
        detailBody.innerHTML = renderContactDetail(result.data);
        bindDetailActions();

        // Render halaman riwayat, tapi jangan pindah ke sana.
        // renderHistoryContent() hanya mengisi isinya.
        renderHistoryContent();
    } catch (error) {
        console.error('openContact:', error);
        const msg = errorBlock('Gagal memuat detail kontak');
        detailBody.innerHTML = msg;
        historyBody.innerHTML = msg;
    }
}

function renderContactDetail({ contact, receivables }) {
    const piutang = Number(contact.outstanding_total) || 0;
    const deposit = Number(contact.deposit_balance) || 0;

    return `
        <!-- Ringkasan saldo -->
        <div class="grid grid-cols-2 gap-3 mb-6">
            <div class="bg-white rounded-xl shadow-sm p-4">
                <span class="text-xs text-gray-500 block mb-1">Piutang Aktif</span>
                <span class="text-lg font-bold ${piutang > 0 ? 'text-red-600' : 'text-gray-400'}">
                    ${rupiah(piutang)}
                </span>
            </div>
            <div class="bg-white rounded-xl shadow-sm p-4">
                <span class="text-xs text-gray-500 block mb-1">Saldo Deposit</span>
                <span class="text-lg font-bold ${deposit > 0 ? 'text-green-600' : 'text-gray-400'}">
                    ${rupiah(deposit)}
                </span>
            </div>
        </div>

        ${contact.notes ? `
            <div class="bg-white rounded-xl shadow-sm p-4 mb-3">
                <span class="text-xs text-gray-500 block">Catatan</span>
                <span class="text-gray-800 text-sm">${escapeHtml(contact.notes)}</span>
            </div>
        ` : ''}

        <!-- Piutang aktif -->
        <div class="flex items-center justify-between mt-6 mb-3">
            <h3 class="font-semibold text-gray-700">Piutang Aktif</h3>
            <div class="flex items-center gap-1">
                ${receivables.length ? `
                    <button data-action="pay-selected" class="text-green-600 hover:text-green-700 text-sm font-semibold min-h-[44px] px-2">
                        Bayar
                    </button>
                ` : ''}
                <button data-action="add-receivable" class="text-primary hover:text-secondary text-sm font-semibold min-h-[44px] px-2">
                    + Tambah
                </button>
            </div>
        </div>

        <div class="space-y-2">
            ${receivables.length
                ? receivables.map(renderReceivableRow).join('')
                : '<div class="bg-white rounded-xl p-4 text-center text-gray-500 text-sm">Tidak ada piutang aktif</div>'}
        </div>

        <!-- Deposit dan riwayat tidak ditampilkan di sini.
             Deposit diakses lewat tombol di halaman Riwayat. -->
    `;
}

// ---------- Halaman Riwayat ----------

// Pindah ke halaman riwayat
function openHistoryScreen() {
    showScreen('contactHistoryScreen');
    renderHistoryContent();
}

// Isi halaman riwayat, tanpa memindahkan layar
function renderHistoryContent() {
    document.getElementById('historyContactName').textContent = currentContact?.name ?? '';

    const body = document.getElementById('contactHistoryBody');
    const hasAny = currentPayments.length || currentDeposits.length;

    if (!hasAny) {
        body.innerHTML = emptyBlock('Belum ada transaksi');
        return;
    }

    body.innerHTML = `
        <!-- Deposit -->
        <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-gray-700">Deposit</h3>
            <button data-action="add-deposit" class="text-primary hover:text-secondary text-sm font-semibold min-h-[44px] px-2">
                + Setor
            </button>
        </div>
        <div class="space-y-2 mb-8">
            ${currentDeposits.length
                ? currentDeposits.map(renderDepositRow).join('')
                : '<div class="bg-white rounded-xl p-4 text-center text-gray-500 text-sm">Belum ada mutasi deposit</div>'}
        </div>

        <!-- Pembayaran -->
        <h3 class="font-semibold text-gray-700 mb-3">Pembayaran</h3>
        <div class="space-y-2">
            ${currentPayments.length
                ? currentPayments.map(renderPaymentRow).join('')
                : '<div class="bg-white rounded-xl p-4 text-center text-gray-500 text-sm">Belum ada pembayaran</div>'}
        </div>
    `;

    body.querySelector('[data-action="add-deposit"]')
        ?.addEventListener('click', openDepositForm);

    body.querySelectorAll('[data-action="void-deposit"]').forEach(btn => {
        btn.addEventListener('click', () => voidDeposit(btn.dataset.id));
    });

    body.querySelectorAll('[data-action="void-payment"]').forEach(btn => {
        btn.addEventListener('click', () => voidPayment(btn.dataset.id));
    });
}

function renderPaymentRow(p) {
    const depositUsed = Number(p.deposit_used) || 0;
    const cash = Number(p.cash_amount) || 0;

    const parts = [];
    if (depositUsed > 0) parts.push('deposit ' + rupiah(depositUsed));
    if (cash > 0) parts.push('tunai ' + rupiah(cash));

    return `
        <div class="bg-white rounded-xl shadow-sm p-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="font-medium text-gray-800">Pelunasan ${rupiah(p.total_amount)}</p>
                <p class="text-xs text-gray-500 mt-0.5">${tanggalSingkat(p.date)}</p>
                <p class="text-xs text-gray-500 mt-1">${parts.join(' + ')}</p>
            </div>
            <button data-action="void-payment" data-id="${p.id}"
                    class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center flex-shrink-0"
                    aria-label="Batalkan pembayaran">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
            </button>
        </div>
    `;
}

function renderDepositRow(d) {
    const isIn = d.type === 'in';
    const label = isIn ? 'Setor' : 'Potong piutang';
    const sign = isIn ? '+' : '−';
    const color = isIn ? 'text-green-600' : 'text-amber-600';

    return `
        <div class="bg-white rounded-xl shadow-sm p-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="font-medium text-gray-800">${label}</p>
                <p class="text-xs text-gray-500 mt-0.5">${tanggalSingkat(d.date)}</p>
                ${d.notes ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(d.notes)}</p>` : ''}
            </div>
            <div class="text-right flex-shrink-0">
                <p class="font-semibold ${color}">${sign}${rupiah(d.amount)}</p>
                ${isIn ? `
                    <button data-action="void-deposit" data-id="${d.id}"
                            class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center ml-auto mt-1"
                            aria-label="Batalkan setoran">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function renderReceivableRow(r) {
    return `
        <div class="bg-white rounded-xl shadow-sm p-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="font-medium text-gray-800 truncate">${escapeHtml(r.description)}</p>
                <p class="text-xs text-gray-500 mt-0.5">${tanggalSingkat(r.date)}</p>
                ${r.notes ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(r.notes)}</p>` : ''}
            </div>
            <div class="text-right flex-shrink-0">
                <p class="font-semibold text-red-600">${rupiah(r.amount)}</p>
                <div class="flex gap-1 mt-1 justify-end">
                    <button data-action="pay-receivable" data-id="${r.id}"
                            class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 flex items-center justify-center"
                            aria-label="Bayar piutang">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
                        </svg>
                    </button>
                    <button data-action="edit-receivable" data-id="${r.id}"
                            class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-primary hover:bg-gray-100 flex items-center justify-center"
                            aria-label="Ubah piutang">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button data-action="void-receivable" data-id="${r.id}"
                            class="min-w-[44px] min-h-[44px] rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                            aria-label="Batalkan piutang">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Pasang handler setelah HTML detail di-render
function bindDetailActions() {
    const body = document.getElementById('contactDetailBody');

    body.querySelector('[data-action="add-receivable"]')
        ?.addEventListener('click', () => openReceivableForm());

    body.querySelectorAll('[data-action="edit-receivable"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = currentContactReceivable(btn.dataset.id);
            if (row) openReceivableForm(row);
        });
    });

    body.querySelectorAll('[data-action="void-receivable"]').forEach(btn => {
        btn.addEventListener('click', () => voidReceivable(btn.dataset.id));
    });

    body.querySelectorAll('[data-action="pay-receivable"]').forEach(btn => {
        btn.addEventListener('click', () => openPaymentForm(btn.dataset.id));
    });

    body.querySelector('[data-action="pay-selected"]')
        ?.addEventListener('click', () => openPaymentForm());
}

function currentContactReceivable(id) {
    return currentReceivables.find(r => r.id === id) ?? null;
}

// ---------- Form Kontak ----------

function openContactForm(contact = null) {
    const isEdit = contact !== null;

    openModal(isEdit ? 'Ubah Kontak' : 'Tambah Kontak', `
        <div class="space-y-3">
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Nama <span class="text-red-500">*</span></label>
                <input id="f-name" type="text" value="${escapeHtml(contact?.name ?? '')}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">No. HP</label>
                <input id="f-phone" type="tel" value="${escapeHtml(contact?.phone ?? '')}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <button id="f-submit" class="w-full min-h-[50px] bg-primary hover:bg-secondary text-white rounded-xl font-semibold active:scale-95 transition-all">
                ${isEdit ? 'Simpan Perubahan' : 'Tambah Kontak'}
            </button>
        </div>
    `);

    document.getElementById('f-submit').addEventListener('click', (e) => {
        saveContact(e.currentTarget, contact?.id ?? null);
    });
}

async function saveContact(btn, id) {
    const payload = {
        name: document.getElementById('f-name').value.trim(),
        phone: document.getElementById('f-phone').value.trim(),
    };

    if (!payload.name) {
        showToast('Nama kontak wajib diisi', 'error');
        return;
    }

    setButtonLoading(btn, true, 'Menyimpan...');

    try {
        const response = await apiFetch(
            id ? '/contacts/' + id : '/contacts',
            {
                method: id ? 'PATCH' : 'POST',
                body: JSON.stringify(payload),
            }
        );
        const result = await response.json();

        if (!result.success) {
            showToast(result.message || 'Gagal menyimpan', 'error');
            return;
        }

        closeModal();
        showToast(result.message, 'success');

        // Muat ulang layar yang sedang tampil supaya angkanya sinkron
        if (id) {
            await openContact(id);
        } else {
            await loadContacts();
        }
    } catch (error) {
        console.error('saveContact:', error);
        showToast('Gagal menyimpan kontak', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

// ---------- Form Piutang ----------

function openReceivableForm(row = null) {
    const isEdit = row !== null;

    openModal(isEdit ? 'Ubah Piutang' : 'Tambah Piutang', `
        <div class="space-y-3">
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Keterangan <span class="text-red-500">*</span></label>
                <input id="r-desc" type="text" value="${escapeHtml(row?.description ?? '')}"
                       placeholder="Contoh: Pinjam uang, Beli barang"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Nilai <span class="text-red-500">*</span></label>
                <input id="r-amount" type="text" inputmode="numeric" value="${row ? formatRibuan(row.amount) : ''}"
                       placeholder="100.000"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Tanggal</label>
                <input id="r-date" type="date" value="${row?.date ?? new Date().toISOString().slice(0, 10)}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <button id="r-submit" class="w-full min-h-[50px] bg-primary hover:bg-secondary text-white rounded-xl font-semibold active:scale-95 transition-all">
                ${isEdit ? 'Simpan Perubahan' : 'Tambah Piutang'}
            </button>
        </div>
    `);

    pasangPemisahRibuan(document.getElementById('r-amount'));

    document.getElementById('r-submit').addEventListener('click', (e) => {
        saveReceivable(e.currentTarget, row?.id ?? null);
    });
}

async function saveReceivable(btn, id) {
    const payload = {
        contact_id: currentContact?.id ?? '',
        description: document.getElementById('r-desc').value.trim(),
        amount: angkaDari(document.getElementById('r-amount').value),
        date: document.getElementById('r-date').value,
    };

    if (!payload.description) {
        showToast('Keterangan wajib diisi', 'error');
        return;
    }
    if (payload.amount <= 0) {
        showToast('Nilai piutang harus lebih dari 0', 'error');
        return;
    }

    setButtonLoading(btn, true, 'Menyimpan...');

    try {
        const response = await apiFetch(
            id ? '/receivables/' + id : '/receivables',
            {
                method: id ? 'PATCH' : 'POST',
                body: JSON.stringify(payload),
            }
        );
        const result = await response.json();

        if (!result.success) {
            showToast(result.message || 'Gagal menyimpan', 'error');
            return;
        }

        closeModal();
        showToast(result.message, 'success');
        await openContact(currentContact.id);
    } catch (error) {
        console.error('saveReceivable:', error);
        showToast('Gagal menyimpan piutang', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

// ---------- Batalkan Piutang ----------

async function voidReceivable(id) {
    const row = currentReceivables.find(r => r.id === id);

    openModal('Batalkan Piutang', `
        <p class="text-gray-600 mb-2">Batalkan piutang berikut?</p>
        ${row ? `
            <div class="bg-gray-50 rounded-xl p-4 mb-4">
                <p class="font-medium text-gray-800">${escapeHtml(row.description)}</p>
                <p class="text-red-600 font-semibold mt-1">${rupiah(row.amount)}</p>
            </div>
        ` : ''}
        <p class="text-sm text-gray-500 mb-5">
            Data tidak dihapus permanen, hanya tidak dihitung lagi. Riwayatnya tetap tersimpan.
        </p>
        <div class="flex gap-3">
            <button onclick="closeModal()" class="flex-1 min-h-[52px] bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold active:scale-95 transition-all">
                Batal
            </button>
            <button id="v-submit" class="flex-1 min-h-[52px] bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold active:scale-95 transition-all">
                Ya, Batalkan
            </button>
        </div>
    `);

    document.getElementById('v-submit').addEventListener('click', async (e) => {
        setButtonLoading(e.currentTarget, true, 'Membatalkan...');

        try {
            const response = await apiFetch('/receivables/' + id, { method: 'DELETE' });
            const result = await response.json();

            if (!result.success) {
                showToast(result.message || 'Gagal membatalkan', 'error');
                return;
            }

            closeModal();
            showToast(result.message, 'success');
            await openContact(currentContact.id);
        } catch (error) {
            console.error('voidReceivable:', error);
            showToast('Gagal membatalkan piutang', 'error');
        } finally {
            setButtonLoading(e.currentTarget, false);
        }
    });
}

// ---------- Setor Deposit ----------

function openDepositForm() {
    openModal('Setor Deposit', `
        <div class="space-y-3">
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Nilai Setoran <span class="text-red-500">*</span></label>
                <input id="d-amount" type="text" inputmode="numeric" placeholder="100.000"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Tanggal</label>
                <input id="d-date" type="date" value="${new Date().toISOString().slice(0, 10)}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Catatan</label>
                <textarea id="d-notes" rows="1" placeholder="Opsional"
                          class="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></textarea>
            </div>
            <button id="d-submit" class="w-full min-h-[50px] bg-primary hover:bg-secondary text-white rounded-xl font-semibold active:scale-95 transition-all">
                Simpan Setoran
            </button>
        </div>
    `);

    pasangPemisahRibuan(document.getElementById('d-amount'));

    document.getElementById('d-submit').addEventListener('click', (e) => {
        saveDeposit(e.currentTarget);
    });
}

async function saveDeposit(btn) {
    const payload = {
        amount: angkaDari(document.getElementById('d-amount').value),
        date: document.getElementById('d-date').value,
        notes: document.getElementById('d-notes').value.trim(),
    };

    if (payload.amount <= 0) {
        showToast('Nilai setoran harus lebih dari 0', 'error');
        return;
    }

    setButtonLoading(btn, true, 'Menyimpan...');

    try {
        const response = await apiFetch(
            '/contacts/' + currentContact.id + '/deposits',
            { method: 'POST', body: JSON.stringify(payload) }
        );
        const result = await response.json();

        if (!result.success) {
            showToast(result.message || 'Gagal menyimpan', 'error');
            return;
        }

        closeModal();
        showToast(result.message, 'success');
        await openContact(currentContact.id, 'contactHistoryScreen');
    } catch (error) {
        console.error('saveDeposit:', error);
        showToast('Gagal menyimpan setoran', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

// ---------- Batalkan Mutasi Deposit ----------

async function voidDeposit(id) {
    const row = currentDeposits.find(d => d.id === id);

    openModal('Batalkan Setoran', `
        <p class="text-gray-600 mb-2">Batalkan setoran berikut?</p>
        ${row ? `
            <div class="bg-gray-50 rounded-xl p-4 mb-4">
                <p class="font-semibold text-green-600">${rupiah(row.amount)}</p>
                <p class="text-xs text-gray-500 mt-1">${tanggalSingkat(row.date)}</p>
            </div>
        ` : ''}
        <p class="text-sm text-gray-500 mb-5">
            Saldo deposit akan berkurang sebesar nilai ini. Kalau depositnya
            sudah terpakai untuk piutang, pembatalan akan ditolak.
        </p>
        <div class="flex gap-3">
            <button onclick="closeModal()" class="flex-1 min-h-[52px] bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold active:scale-95 transition-all">
                Batal
            </button>
            <button id="vd-submit" class="flex-1 min-h-[52px] bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold active:scale-95 transition-all">
                Ya, Batalkan
            </button>
        </div>
    `);

    document.getElementById('vd-submit').addEventListener('click', async (e) => {
        setButtonLoading(e.currentTarget, true, 'Membatalkan...');

        try {
            const response = await apiFetch('/deposits/' + id, { method: 'DELETE' });
            const result = await response.json();

            if (!result.success) {
                showToast(result.message || 'Gagal membatalkan', 'error');
                return;
            }

            closeModal();
            showToast(result.message, 'success');
            await openContact(currentContact.id, 'contactHistoryScreen');
        } catch (error) {
            console.error('voidDeposit:', error);
            showToast('Gagal membatalkan setoran', 'error');
        } finally {
            setButtonLoading(e.currentTarget, false);
        }
    });
}

// ---------- Pembayaran ----------

// Piutang yang sedang dicentang di layar bayar
let selectedReceivables = new Set();

/**
 * Buka layar bayar. Kalau dipanggil dari tombol bayar di baris piutang,
 * piutang itu langsung tercentang.
 */
function openPaymentForm(preselectId = null) {
    if (!currentReceivables.length) {
        showToast('Tidak ada piutang aktif untuk dibayar', 'error');
        return;
    }

    selectedReceivables = new Set(preselectId ? [preselectId] : []);

    const deposit = Number(currentContact.deposit_balance) || 0;

    openModal('Bayar Piutang', `
        <div class="space-y-3">
            <!-- Pilih piutang -->
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Pilih piutang yang dilunasi</label>
                <div class="space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-1.5">
                    ${currentReceivables.map(r => `
                        <label class="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" data-pay-id="${r.id}"
                                   ${selectedReceivables.has(r.id) ? 'checked' : ''}
                                   class="mt-1 w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary">
                            <span class="flex-1 min-w-0">
                                <span class="block text-sm font-medium text-gray-800 truncate">${escapeHtml(r.description)}</span>
                                <span class="block text-xs text-gray-500">${tanggalSingkat(r.date)}</span>
                            </span>
                            <span class="text-sm font-semibold text-red-600 flex-shrink-0">${rupiah(r.amount)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Ringkasan perhitungan -->
            <div class="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-600">Total dipilih</span>
                    <span id="sum-total" class="font-semibold text-gray-800">Rp 0</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Potong deposit</span>
                    <span id="sum-deposit" class="font-semibold text-amber-600">Rp 0</span>
                </div>
                <div class="flex justify-between border-t border-gray-200 pt-2">
                    <span class="text-gray-700 font-medium">Sisa dibayar tunai</span>
                    <span id="sum-cash" class="font-bold text-gray-900">Rp 0</span>
                </div>
                <div class="flex justify-between text-xs text-gray-500">
                    <span>Saldo deposit tersedia</span>
                    <span>${rupiah(deposit)}</span>
                </div>
            </div>

            <!-- Nominal tunai -->
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Uang Tunai Diterima</label>
                <input id="p-cash" type="text" inputmode="numeric" placeholder="0" value=""
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
                <p id="p-hint" class="text-xs text-gray-500 mt-2"></p>
            </div>

            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Tanggal</label>
                <input id="p-date" type="date" value="${new Date().toISOString().slice(0, 10)}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 min-h-[46px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>

            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Catatan</label>
                <textarea id="p-notes" rows="1" placeholder="Opsional"
                          class="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"></textarea>
            </div>

            <button id="p-submit" class="w-full min-h-[50px] bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold active:scale-95 transition-all">
                Simpan Pembayaran
            </button>
        </div>
    `);

    // Centang piutang
    document.querySelectorAll('[data-pay-id]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) {
                selectedReceivables.add(cb.dataset.payId);
            } else {
                selectedReceivables.delete(cb.dataset.payId);
            }
            refreshPreview();
        });
    });

    // Hitung ulang saat tunai diisi/diubah
    // Pemisah ribuan dipasang lebih dulu, baru hint diperbarui.
    // Urutannya penting: pendengar 'input' dijalankan sesuai urutan
    // pendaftaran, jadi hint akan membaca nilai yang sudah diformat.
    pasangPemisahRibuan(document.getElementById('p-cash'));
    document.getElementById('p-cash').addEventListener('input', updateCashHint);

    document.getElementById('p-submit').addEventListener('click', (e) => {
        savePayment(e.currentTarget);
    });

    refreshPreview();
}

/**
 * Minta perhitungan ke server, lalu perbarui tiga angka dan hint tunai.
 * Perhitungan di server supaya aturannya hanya ada di satu tempat.
 */
async function refreshPreview() {
    const ids = Array.from(selectedReceivables);

    // Belum ada yang dicentang — nol kan tanpa perlu tanya server
    if (!ids.length) {
        setSummary({ total: 0, deposit_used: 0, cash_required: 0 });
        return;
    }

    try {
        const response = await apiFetch(
            '/contacts/' + currentContact.id + '/payments/preview',
            { method: 'POST', body: JSON.stringify({ receivable_ids: ids }) }
        );
        const result = await response.json();

        if (!result.success) {
            showToast(result.message || 'Gagal menghitung', 'error');
            return;
        }

        setSummary(result.data);
    } catch (error) {
        console.error('refreshPreview:', error);
    }
}

function setSummary(data) {
    document.getElementById('sum-total').textContent = rupiah(data.total);
    document.getElementById('sum-deposit').textContent = '−' + rupiah(data.deposit_used);
    document.getElementById('sum-cash').textContent = rupiah(data.cash_required);

    // Simpan supaya hint tidak perlu menunggu request lagi
    window.__cashRequired = Number(data.cash_required) || 0;
    updateCashHint();
}

function updateCashHint() {
    const hint = document.getElementById('p-hint');
    const required = window.__cashRequired || 0;
    const input = document.getElementById('p-cash');
    const cash = angkaDari(input.value);

    if (required === 0 && cash === 0) {
        hint.textContent = '';
        return;
    }

    if (cash < required) {
        hint.innerHTML = `<span class="text-red-600">Kurang ${rupiah(required - cash)}</span>`;
    } else if (cash > required) {
        hint.innerHTML = `<span class="text-green-600">Kelebihan ${rupiah(cash - required)} masuk deposit</span>`;
    } else {
        hint.innerHTML = `<span class="text-green-600">Pas</span>`;
    }
}

async function savePayment(btn) {
    const ids = Array.from(selectedReceivables);

    if (!ids.length) {
        showToast('Pilih minimal satu piutang', 'error');
        return;
    }

    const payload = {
        receivable_ids: ids,
        cash_amount: angkaDari(document.getElementById('p-cash').value),
        date: document.getElementById('p-date').value,
        notes: document.getElementById('p-notes').value.trim(),
    };

    setButtonLoading(btn, true, 'Memproses...');

    try {
        const response = await apiFetch(
            '/contacts/' + currentContact.id + '/payments',
            { method: 'POST', body: JSON.stringify(payload) }
        );
        const result = await response.json();

        if (!result.success) {
            showToast(result.message || 'Gagal menyimpan pembayaran', 'error');
            return;
        }

        closeModal();
        showToast(result.message, 'success');
        await openContact(currentContact.id);
    } catch (error) {
        console.error('savePayment:', error);
        showToast('Gagal menyimpan pembayaran', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

// ---------- Batalkan Transaksi Pembayaran ----------

async function voidPayment(id) {
    const row = currentPayments.find(p => p.id === id);

    openModal('Batalkan Pembayaran', `
        <p class="text-gray-600 mb-2">Batalkan transaksi berikut?</p>
        ${row ? `
            <div class="bg-gray-50 rounded-xl p-4 mb-4">
                <p class="font-semibold text-gray-800">Pelunasan ${rupiah(row.total_amount)}</p>
                <p class="text-xs text-gray-500 mt-1">${tanggalSingkat(row.date)}</p>
            </div>
        ` : ''}
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
            <p class="text-sm text-amber-800">
                Piutang yang dilunasi akan kembali aktif, dan pemakaian
                deposit dari transaksi ini ikut dibatalkan.
            </p>
        </div>
        <div class="flex gap-3">
            <button onclick="closeModal()" class="flex-1 min-h-[52px] bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold active:scale-95 transition-all">
                Batal
            </button>
            <button id="vp-submit" class="flex-1 min-h-[52px] bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold active:scale-95 transition-all">
                Ya, Batalkan
            </button>
        </div>
    `);

    document.getElementById('vp-submit').addEventListener('click', async (e) => {
        setButtonLoading(e.currentTarget, true, 'Membatalkan...');

        try {
            const response = await apiFetch('/payments/' + id, { method: 'DELETE' });
            const result = await response.json();

            if (!result.success) {
                showToast(result.message || 'Gagal membatalkan', 'error');
                return;
            }

            closeModal();
            showToast(result.message, 'success');
            await openContact(currentContact.id, 'contactHistoryScreen');
        } catch (error) {
            console.error('voidPayment:', error);
            showToast('Gagal membatalkan transaksi', 'error');
        } finally {
            setButtonLoading(e.currentTarget, false);
        }
    });
}

// ---------- Blok tampilan seragam ----------

function loadingBlock(text) {
    return `
        <div class="bg-white rounded-xl p-6 shadow-sm flex items-center justify-center gap-3">
            <svg class="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-gray-500">${escapeHtml(text)}</span>
        </div>
    `;
}

function emptyBlock(text) {
    return `<div class="bg-white rounded-xl p-6 shadow-sm"><p class="text-gray-500 text-center">${escapeHtml(text)}</p></div>`;
}

function errorBlock(text) {
    return `<div class="bg-red-50 rounded-xl p-4"><p class="text-red-500 text-center">${escapeHtml(text)}</p></div>`;
}
