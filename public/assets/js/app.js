// Configuration
const API_BASE = '/api';

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    updateTime();
    setInterval(updateTime, 1000);

    const loggedIn = await initAuth();
    renderAuthState();

    if (loggedIn) {
        loadTodayStatus();
    }
});

// Called by auth.js whenever the session changes
function onAuthChanged(session) {
    renderAuthState();
    if (session) {
        loadTodayStatus();
    }
}

// Reflect login state in the UI
function renderAuthState() {
    const landingScreen = document.getElementById('landingScreen');
    const menuScreen = document.getElementById('menuScreen');
    const userInfo = document.getElementById('userInfo');
    const userIdEl = document.getElementById('userId');
    const absentBtn = document.getElementById('absentBtn');
    const checkBtn = document.getElementById('checkBtn');

    if (currentUser) {
        // Sudah login -> tampilkan menu utama
        if (landingScreen) landingScreen.classList.add('hidden');
        if (menuScreen) menuScreen.classList.remove('hidden');

        if (userInfo) userInfo.classList.remove('hidden');
        if (userIdEl) {
            userIdEl.textContent = currentUser.email || currentUser.phone || currentUser.id;
        }

        // Status tombol ditentukan oleh updateButtonStates(), bukan di sini
        if (absentBtn) absentBtn.disabled = false;
        if (checkBtn) checkBtn.disabled = false;
    } else {
        // Belum login -> tampilkan landing page
        if (landingScreen) landingScreen.classList.remove('hidden');
        if (menuScreen) menuScreen.classList.add('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        if (userIdEl) userIdEl.textContent = '-';

        [absentBtn, checkBtn].forEach(btn => {
            if (btn) {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            }
        });
    }
}

/**
 * Fetch wrapper that attaches the Supabase access token so the
 * backend can authenticate against RLS.
 */
async function apiFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// Update current time display
function updateTime() {
    const now = new Date();

    const timeEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');

    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    timeEl.textContent = now.toLocaleTimeString('id-ID', timeOptions);
    dateEl.textContent = now.toLocaleDateString('id-ID', dateOptions);
}

// Show specific screen
function showScreen(screenId) {
    // Belum login: hanya boleh di landing page
    if (!currentUser && screenId !== 'landingScreen') {
        screenId = 'landingScreen';
    }

    // Hide all screens
    document.querySelectorAll('[id$="Screen"]').forEach(screen => {
        screen.classList.add('hidden');
    });

    // Show selected screen
    document.getElementById(screenId).classList.remove('hidden');

    // Load data for specific screens
    if (screenId === 'historyScreen') {
        loadHistory();
    }

    if (screenId === 'settingsScreen') {
        checkConnection();
    }

    if (screenId === 'contactsScreen' && typeof loadContacts === 'function') {
        loadContacts();
    }
}

/**
 * Aktifkan mode loading pada tombol.
 * Menyimpan teks & isi asli di dataset supaya bisa dikembalikan persis.
 */
function setButtonLoading(btn, loading, loadingText = null) {
    if (!btn) return;

    if (loading) {
        // Simpan kondisi awal hanya sekali
        if (btn.dataset.loading === '1') return;
        btn.dataset.loading = '1';
        btn.dataset.originalHtml = btn.innerHTML;
        if (loadingText) btn.dataset.originalText = btn.textContent.trim();

        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');

        btn.innerHTML = `
            <span class="inline-flex items-center justify-center gap-2">
                <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                ${loadingText ? `<span>${loadingText}</span>` : ''}
            </span>
        `;
    } else {
        if (btn.dataset.loading !== '1') return;
        delete btn.dataset.loading;

        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.originalHtml;
        delete btn.dataset.originalText;

        btn.disabled = false;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    toastMessage.textContent = message;

    // Set color based on type
    toast.className = toast.className.replace(/bg-\w+-\d+/g, '');
    toast.classList.add(type === 'success' ? 'bg-green-500' : 'bg-red-500');
    toast.classList.add('text-white');

    // Show toast
    toast.classList.remove('translate-y-20', 'opacity-0');

    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

// Load today's attendance status
async function loadTodayStatus() {
    try {
        const response = await apiFetch("/status", {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success && result.data) {
            updateButtonStates(result.data);
        }
    } catch (error) {
        console.error('Error loading today status:', error);
    }
}

// Update button states based on attendance
function updateButtonStates(data) {
    const checkBtn = document.getElementById('checkBtn');
    const absentBtn = document.getElementById('absentBtn');
    const absentForm = document.getElementById('absentForm');

    // Reset ke kondisi awal: belum absen, tombol = Check In
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check In';
    checkBtn.dataset.action = 'checkin';
    setCheckBtnColor('green');
    absentBtn.classList.remove('hidden');
    absentBtn.disabled = false;
    absentBtn.textContent = 'Tidak Hadir (Sakit / Cuti / Izin)';

    if (data.status) {
        // Sudah tercatat Sakit/Cuti/Izin hari ini
        checkBtn.disabled = true;
        checkBtn.textContent = data.status.status_type;
        checkBtn.classList.remove('bg-green-500', 'hover:bg-green-600', 'bg-blue-500', 'hover:bg-blue-600');
        checkBtn.classList.add('bg-gray-400');

        // Tidak bisa absen lagi, sembunyikan tombol & form tidak hadir
        absentBtn.classList.add('hidden');
        if (absentForm) {
            absentForm.classList.add('hidden');
        }

        showToast(`Hari ini tercatat: ${data.status.status_type}`);
        return;
    }

    const records = data.attendance || [];
    const hasCheckIn = records.some(r => r.status === 'Check In');
    const hasCheckOut = records.some(r => r.status === 'Check Out');

    if (hasCheckIn) {
        // Sudah masuk -> sembunyikan tombol tidak hadir, tombol jadi Check Out
        absentBtn.classList.add('hidden');

        if (hasCheckOut) {
            // Sudah masuk dan keluar -> tidak ada aksi lagi
            checkBtn.disabled = true;
            checkBtn.textContent = 'Selesai';
            checkBtn.classList.remove('bg-green-500', 'hover:bg-green-600', 'bg-blue-500', 'hover:bg-blue-600');
            checkBtn.classList.add('bg-gray-400');
        } else {
            checkBtn.textContent = 'Check Out';
            checkBtn.dataset.action = 'checkout';
            setCheckBtnColor('blue');
        }
    }
}

// Ganti warna tombol check sesuai aksi
function setCheckBtnColor(color) {
    const checkBtn = document.getElementById('checkBtn');

    checkBtn.classList.remove(
        'bg-green-500', 'hover:bg-green-600',
        'bg-blue-500', 'hover:bg-blue-600',
        'bg-gray-400'
    );

    if (color === 'blue') {
        checkBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
    } else {
        checkBtn.classList.add('bg-green-500', 'hover:bg-green-600');
    }
}

// Satu handler untuk check in / check out
function handleCheck() {
    const checkBtn = document.getElementById('checkBtn');

    if (checkBtn.dataset.action === 'checkout') {
        checkOut();
    } else {
        checkIn();
    }
}

// Toggle absent form visibility
function toggleAbsentForm() {
    const absentForm = document.getElementById('absentForm');
    const absentBtn = document.getElementById('absentBtn');

    if (absentForm.classList.contains('hidden')) {
        absentForm.classList.remove('hidden');
        absentBtn.textContent = 'Sembunyikan Form';
    } else {
        absentForm.classList.add('hidden');
        absentBtn.textContent = 'Tidak Hadir (Sakit / Cuti / Izin)';
    }
}

// Check In
async function checkIn() {
    const checkBtn = document.getElementById('checkBtn');
    setButtonLoading(checkBtn, true, 'Check In...');

    let succeeded = false;

    try {
        const response = await apiFetch("/checkin", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            succeeded = true;
            showToast(result.message, 'success');
        } else {
            showToast(result.message, 'error');
        }
    } catch (error) {
        console.error('Error checking in:', error);
        showToast('Gagal melakukan check in', 'error');
    }

    // Lepas spinner dulu, baru sinkronkan status tombol —
    // urutan ini penting supaya updateButtonStates() tidak ditimpa restore.
    setButtonLoading(checkBtn, false);

    if (succeeded) {
        await loadTodayStatus();
    }
}

// Check Out
async function checkOut() {
    const checkBtn = document.getElementById('checkBtn');
    setButtonLoading(checkBtn, true, 'Check Out...');

    let succeeded = false;

    try {
        const response = await apiFetch("/checkout", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            succeeded = true;
            showToast(result.message, 'success');
        } else {
            showToast(result.message, 'error');
        }
    } catch (error) {
        console.error('Error checking out:', error);
        showToast('Gagal melakukan check out', 'error');
    }

    setButtonLoading(checkBtn, false);

    if (succeeded) {
        await loadTodayStatus();
    }
}

// Submit status (Sakit/Cuti/Izin)
async function submitStatus() {
    const statusType = document.getElementById('statusType').value;
    const notes = document.getElementById('notes').value;

    if (!statusType) {
        showToast('Pilih status terlebih dahulu', 'error');
        return;
    }

    const submitBtn = document.getElementById('submitAbsentBtn');
    setButtonLoading(submitBtn, true, 'Menyimpan...');

    let succeeded = false;

    try {
        const response = await apiFetch("/status", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status_type: statusType,
                notes: notes
            })
        });

        const result = await response.json();

        if (result.success) {
            succeeded = true;
            showToast(result.message, 'success');
            document.getElementById('statusType').value = '';
            document.getElementById('notes').value = '';
        } else {
            showToast(result.message, 'error');
        }
    } catch (error) {
        console.error('Error submitting status:', error);
        showToast('Gagal menyimpan status', 'error');
    }

    setButtonLoading(submitBtn, false);

    if (succeeded) {
        await loadTodayStatus();
    }
}

// Load history
async function loadHistory() {
    const historyList = document.getElementById('historyList');

    if (!currentUser) {
        historyList.innerHTML = `
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <p class="text-gray-500 text-center">Login dulu untuk melihat riwayat</p>
            </div>
        `;
        return;
    }

    historyList.innerHTML = `
        <div class="bg-white rounded-xl p-6 shadow-sm flex items-center justify-center gap-3">
            <svg class="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-gray-500">Memuat data...</span>
        </div>
    `;

    try {
        const response = await apiFetch('/history', { method: 'GET' });
        const result = await response.json();

        if (!result.success) {
            historyList.innerHTML = `
                <div class="bg-red-50 rounded-xl p-4">
                    <p class="text-red-500 text-center">${result.message || 'Gagal memuat riwayat'}</p>
                </div>
            `;
            return;
        }

        if (!result.data || result.data.length === 0) {
            historyList.innerHTML = `
                <div class="bg-white rounded-xl p-6 shadow-sm">
                    <p class="text-gray-500 text-center">Belum ada riwayat absensi</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = result.data.map(renderHistoryItem).join('');
    } catch (error) {
        console.error('Error loading history:', error);
        historyList.innerHTML = `
            <div class="bg-red-50 rounded-xl p-4">
                <p class="text-red-500 text-center">Gagal memuat riwayat</p>
            </div>
        `;
    }
}

// Render satu baris riwayat
function renderHistoryItem(item) {
    const dateLabel = formatDate(item.date);

    // Kasus tidak hadir (Sakit/Cuti/Izin)
    if (item.absent) {
        const notes = item.absent.notes
            ? `<p class="text-gray-500 text-sm mt-1">${escapeHtml(item.absent.notes)}</p>`
            : '';

        return `
            <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-amber-400">
                <div class="flex items-center justify-between mb-1">
                    <span class="font-semibold text-gray-800">${dateLabel}</span>
                    <span class="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                        ${escapeHtml(item.absent.status_type)}
                    </span>
                </div>
                ${notes}
            </div>
        `;
    }

    // Kasus hadir: tampilkan jam check in / check out
    const checkIn = (item.records || []).find(r => r.status === 'Check In');
    const checkOut = (item.records || []).find(r => r.status === 'Check Out');

    const inLabel = checkIn ? formatTime(checkIn.time) : '-';
    const outLabel = checkOut ? formatTime(checkOut.time) : '-';

    return `
        <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
            <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-gray-800">${dateLabel}</span>
                <span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">Hadir</span>
            </div>
            <div class="flex gap-6 text-sm">
                <div>
                    <span class="text-gray-500">Masuk</span>
                    <p class="font-medium text-gray-800">${inLabel}</p>
                </div>
                <div>
                    <span class="text-gray-500">Keluar</span>
                    <p class="font-medium text-gray-800">${outLabel}</p>
                </div>
            </div>
        </div>
    `;
}

// Format tanggal "2026-09-26" -> "Jumat, 26 Sep 2026"
function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// Format waktu ISO -> "08:30"
function formatTime(isoStr) {
    const date = new Date(isoStr);
    return date.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

// Cegah XSS saat menampilkan keterangan dari user
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Check database connection
async function checkConnection() {
    const dbStatusDot = document.getElementById('dbStatusDot');
    const dbStatusText = document.getElementById('dbStatusText');
    const serverTimeEl = document.getElementById('serverTime');

    try {
        const startTime = Date.now();
        const response = await apiFetch("/health", { method: 'GET' });

        const latency = Date.now() - startTime;

        if (!response.ok) {
            throw new Error('Connection failed');
        }

        const result = await response.json();

        if (dbStatusDot) {
            dbStatusDot.classList.remove('bg-yellow-400', 'bg-red-500');
            dbStatusDot.classList.add('bg-green-500');
        }
        if (dbStatusText) {
            dbStatusText.textContent = `Terhubung (${latency}ms)`;
            dbStatusText.classList.remove('text-gray-500', 'text-red-500');
            dbStatusText.classList.add('text-green-600');
        }
        if (serverTimeEl) {
            serverTimeEl.textContent = result.timestamp || new Date().toLocaleString('id-ID');
        }

        return true;
    } catch (error) {
        console.error('Connection error:', error);

        if (dbStatusDot) {
            dbStatusDot.classList.remove('bg-yellow-400', 'bg-green-500');
            dbStatusDot.classList.add('bg-red-500');
        }
        if (dbStatusText) {
            dbStatusText.textContent = 'Tidak terhubung';
            dbStatusText.classList.remove('text-gray-500', 'text-green-600');
            dbStatusText.classList.add('text-red-500');
        }
        if (serverTimeEl) {
            serverTimeEl.textContent = '--';
        }

        return false;
    }
}

// Simple moment-like function (removed - using native Date)
