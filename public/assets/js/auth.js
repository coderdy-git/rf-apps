// Supabase Auth — Google OAuth
const SUPABASE_URL = 'https://kzlgfyzsaksichdeivcs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6bGdmeXpzYWtzaWNoZGVpdmNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMDgxODgsImV4cCI6MjA5NTc4NDE4OH0.HDIi6M4Ct-hEbfnyRK48f-RM41RX-VfXb9AInqgQ3eE';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let accessToken = null;
let currentUser = null;

// Get the current session, and surface any OAuth error from the URL
async function initAuth() {
    // Supabase mengembalikan error di URL hash, mis:
    // #error=access_denied&error_description=...
    const hash = new URLSearchParams(window.location.hash.substring(1));
    const query = new URLSearchParams(window.location.search);
    const urlError = hash.get('error') || query.get('error');
    const urlErrorDesc = hash.get('error_description') || query.get('error_description');

    if (urlError) {
        console.error('OAuth error:', urlError, urlErrorDesc);
        alert('Login gagal:\n\n' + urlError + '\n\n' + (urlErrorDesc || ''));
        // Bersihkan URL supaya refresh tidak menampilkan error lagi
        history.replaceState(null, '', window.location.pathname);
    }

    const { data, error } = await sb.auth.getSession();

    if (error) {
        console.error('getSession error:', error);
    }

    if (data.session) {
        accessToken = data.session.access_token;
        currentUser = data.session.user;
    }

    // Jaga token tetap segar saat pindah tab / token kadaluarsa
    sb.auth.onAuthStateChange((_event, session) => {
        accessToken = session?.access_token ?? null;
        currentUser = session?.user ?? null;
        if (typeof onAuthChanged === 'function') {
            onAuthChanged(session);
        }
    });

    return !!accessToken;
}

// Login dengan Google
async function signInWithGoogle() {
    // Harus cocok persis dengan entry di Supabase → Authentication → URL Configuration
    const redirectTo = window.location.origin + window.location.pathname;

    const loginBtn = document.querySelector('#landingScreen button');
    if (typeof setButtonLoading === 'function') {
        setButtonLoading(loginBtn, true, 'Menghubungkan...');
    }

    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo,
            queryParams: {
                access_type: 'offline',
                prompt: 'consent'
            }
        }
    });

    if (error) {
        console.error('signInWithOAuth error:', error);
        showToast('Gagal login: ' + error.message, 'error');

        // Hanya kembalikan tombol kalau gagal — kalau sukses, halaman redirect
        if (typeof setButtonLoading === 'function') {
            setButtonLoading(loginBtn, false);
        }
    }
}

// Logout
async function signOut() {
    const logoutBtn = document.querySelector('#userInfo button');
    if (typeof setButtonLoading === 'function') {
        setButtonLoading(logoutBtn, true, 'Keluar...');
    }

    try {
        await sb.auth.signOut();
    } catch (error) {
        console.error('signOut error:', error);
    } finally {
        if (typeof setButtonLoading === 'function') {
            setButtonLoading(logoutBtn, false);
        }
    }

    accessToken = null;
    currentUser = null;

    // Kembali ke landing page tanpa reload halaman
    if (typeof renderAuthState === 'function') {
        renderAuthState();
    }
    if (typeof showScreen === 'function') {
        showScreen('landingScreen');
    }
}
