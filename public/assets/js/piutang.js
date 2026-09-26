// ============ BUKU PIUTANG ============
//
// Bergantung pada app.js (apiFetch, showToast, setButtonLoading) dan
// auth.js (currentUser). Dimuat setelah keduanya.

let currentContact = null;
let currentReceivables = [];
let searchTimer = null;

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

// ---------- Modal ----------

function openModal(title, bodyHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    const modal = document.getElementById('modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'modal') closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ---------- Daftar Kontak ----------

function debouncedLoadContacts() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadContacts, 300);
}

async function loadContacts() {
    const list = document.getElementById('contactList');
    const search = document.getElementById('contactSearch')?.value.trim() ?? '';

    list.innerHTML = loadingBlock('Memuat kontak...');

    try {
        const qs = search ? '?search=' + encodeURIComponent(search) : '';
        const response = await apiFetch('/contacts' + qs, { method: 'GET' });
        const result = await response.json();

        if (!result.success) {
            list.innerHTML = errorBlock(result.message || 'Gagal memuat kontak');
            return;
        }

        if (!result.data.length) {
            list.innerHTML = emptyBlock(
                search ? 'Kontak tidak ditemukan' : 'Belum ada kontak'
            );
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

async function openContact(id) {
    showScreen('contactDetailScreen');

    const body = document.getElementById('contactDetailBody');
    document.getElementById('contactDetailName').textContent = 'Memuat...';
    body.innerHTML = loadingBlock('Memuat detail...');

    try {
        const response = await apiFetch('/contacts/' + id, { method: 'GET' });
        const result = await response.json();

        if (!result.success) {
            body.innerHTML = errorBlock(result.message || 'Kontak tidak ditemukan');
            return;
        }

        currentContact = result.data.contact;
        currentReceivables = result.data.receivables ?? [];
        document.getElementById('contactDetailName').textContent = currentContact.name;

        body.innerHTML = renderContactDetail(result.data);
        bindDetailActions();
    } catch (error) {
        console.error('openContact:', error);
        body.innerHTML = errorBlock('Gagal memuat detail kontak');
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

        ${contact.phone ? `
            <div class="bg-white rounded-xl shadow-sm p-4 mb-3">
                <span class="text-xs text-gray-500 block">No. HP</span>
                <span class="text-gray-800">${escapeHtml(contact.phone)}</span>
            </div>
        ` : ''}

        ${contact.notes ? `
            <div class="bg-white rounded-xl shadow-sm p-4 mb-3">
                <span class="text-xs text-gray-500 block">Catatan</span>
                <span class="text-gray-800 text-sm">${escapeHtml(contact.notes)}</span>
            </div>
        ` : ''}

        <!-- Piutang aktif -->
        <div class="flex items-center justify-between mt-6 mb-3">
            <h3 class="font-semibold text-gray-700">Piutang Aktif</h3>
            <button data-action="add-receivable" class="text-primary hover:text-secondary text-sm font-semibold min-h-[44px] px-2">
                + Tambah
            </button>
        </div>

        <div class="space-y-2 mb-6">
            ${receivables.length
                ? receivables.map(renderReceivableRow).join('')
                : '<div class="bg-white rounded-xl p-4 text-center text-gray-500 text-sm">Tidak ada piutang aktif</div>'}
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
}

function currentContactReceivable(id) {
    return currentReceivables.find(r => r.id === id) ?? null;
}

// ---------- Form Kontak ----------

function openContactForm(contact = null) {
    const isEdit = contact !== null;

    openModal(isEdit ? 'Ubah Kontak' : 'Tambah Kontak', `
        <div class="space-y-4">
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Nama <span class="text-red-500">*</span></label>
                <input id="f-name" type="text" value="${escapeHtml(contact?.name ?? '')}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-3 min-h-[48px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">No. HP</label>
                <input id="f-phone" type="tel" value="${escapeHtml(contact?.phone ?? '')}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-3 min-h-[48px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Catatan</label>
                <textarea id="f-notes" rows="2"
                          class="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">${escapeHtml(contact?.notes ?? '')}</textarea>
            </div>
            <button id="f-submit" class="w-full min-h-[52px] bg-primary hover:bg-secondary text-white rounded-xl font-semibold active:scale-95 transition-all">
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
        notes: document.getElementById('f-notes').value.trim(),
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
        <div class="space-y-4">
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Keterangan <span class="text-red-500">*</span></label>
                <input id="r-desc" type="text" value="${escapeHtml(row?.description ?? '')}"
                       placeholder="Contoh: Pinjam uang, Beli barang"
                       class="w-full border border-gray-300 rounded-xl px-4 py-3 min-h-[48px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Nilai <span class="text-red-500">*</span></label>
                <input id="r-amount" type="text" inputmode="numeric" value="${row ? Number(row.amount) : ''}"
                       placeholder="100000"
                       class="w-full border border-gray-300 rounded-xl px-4 py-3 min-h-[48px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Tanggal</label>
                <input id="r-date" type="date" value="${row?.date ?? new Date().toISOString().slice(0, 10)}"
                       class="w-full border border-gray-300 rounded-xl px-4 py-3 min-h-[48px] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            <div>
                <label class="block text-gray-600 mb-2 text-sm font-medium">Catatan</label>
                <textarea id="r-notes" rows="2"
                          class="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent">${escapeHtml(row?.notes ?? '')}</textarea>
            </div>
            <button id="r-submit" class="w-full min-h-[52px] bg-primary hover:bg-secondary text-white rounded-xl font-semibold active:scale-95 transition-all">
                ${isEdit ? 'Simpan Perubahan' : 'Tambah Piutang'}
            </button>
        </div>
    `);

    document.getElementById('r-submit').addEventListener('click', (e) => {
        saveReceivable(e.currentTarget, row?.id ?? null);
    });
}

async function saveReceivable(btn, id) {
    const payload = {
        contact_id: currentContact?.id ?? '',
        description: document.getElementById('r-desc').value.trim(),
        amount: document.getElementById('r-amount').value.trim(),
        date: document.getElementById('r-date').value,
        notes: document.getElementById('r-notes').value.trim(),
    };

    if (!payload.description) {
        showToast('Keterangan wajib diisi', 'error');
        return;
    }
    if (!payload.amount || Number(payload.amount.replace(/[^\d]/g, '')) <= 0) {
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
