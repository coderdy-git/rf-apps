# Aplikasi Pencatat Absen

Aplikasi pencatat absensi sederhana dengan PHP dan Supabase.

## Fitur

- ✅ Menu utama dengan icon (bisa ditambah fitur baru)
- ✅ Icon gear untuk Settings di kanan atas
- ✅ Indikator koneksi database real-time
- ✅ Check In / Check Out dengan timestamp
- ✅ Status kehadiran (Sakit, Cuti, Izin, Kerja Dari Rumah)
- ✅ Keterangan tambahan (opsional)
- ✅ Mobile-first responsive design
- ✅ Toast notification untuk feedback
- ✅ API endpoints lengkap
- ✅ Halaman Settings dengan informasi user

## Teknologi

- **Backend**: PHP 8.0+
- **Database**: Supabase (PostgreSQL)
- **Frontend**: HTML5, Tailwind CSS (CDN)
- **Authentication**: Supabase Auth (Google OAuth)

## Struktur Project

```
rizky-apps/
├── public/
│   ├── index.php          # Entry point
│   ├── index.html         # Main UI
│   └── assets/
│       ├── css/
│       ├── js/
│       │   └── app.js     # JavaScript logic
│       └── images/
├── src/
│   ├── config/
│   │   └── database.php   # Supabase connection
│   ├── controllers/
│   │   └── AttendanceController.php
│   ├── models/
│   │   └── AttendanceModel.php
│   └── views/
├── .env                   # Environment variables
├── .gitignore
├── composer.json
└── README.md
```

## Instalasi

### 1. Clone Repository

```bash
cd /home/rf/Projects/rizky-apps
```

### 2. Install Dependencies

```bash
composer install
```

### 3. Setup Environment Variables

Salin template lalu isi dengan nilai dari **Supabase Dashboard → Project Settings → API**:

```bash
cp .env.example .env
```

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

> `.env` sudah masuk `.gitignore` sehingga tidak akan ikut ter-commit.
> Jangan pernah mengganti anon key dengan `service_role` key di file ini.

### 4. Setup Database di Supabase

Jalankan SQL berikut di Supabase SQL Editor:

```sql
-- Table untuk status kehadiran
CREATE TABLE attendance_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    status_type VARCHAR(20) NOT NULL CHECK (status_type IN ('Sakit', 'Cuti', 'Izin', 'Kerja Dari Rumah')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_user_date_status UNIQUE (user_id, date)
);

-- Index untuk performa
CREATE INDEX idx_attendance_status_user_id ON attendance_status(user_id);
CREATE INDEX idx_attendance_status_date ON attendance_status(date);
CREATE INDEX idx_attendance_status_user_date ON attendance_status(user_id, date);
```

### 5. Setup Web Server

**Option A: PHP Built-in Server (Development)**

```bash
cd public
php -S localhost:8000
```

Buka browser: `http://localhost:8000`

**Option B: Apache/Nginx (Production)**

Point document root ke folder `public/`.

## API Endpoints

### Check In
```
POST /api/checkin
```

### Check Out
```
POST /api/checkout
```

### Submit Status (Sakit/Cuti/Izin)
```
POST /api/status
Body: {
    "status_type": "Sakit",
    "notes": "Demam"
}
```

### Get Today Status
```
GET /api/status
```

## Setup Authentication (Google Login)

Login memakai Supabase Auth dengan provider Google. Gratis tanpa batas kuota.

### 1. Aktifkan provider Google di Supabase

Supabase Dashboard → **Authentication → Providers → Google**:

1. Enable **Google**
2. Isi **Client ID** dan **Client Secret** dari Google Cloud Console
3. Simpan

### 2. Setup Google Cloud Console

**APIs & Services → Credentials → Create Credentials → OAuth client ID**:

- Application type: **Web application**
- **Authorized JavaScript origins**: `http://localhost:8000`
- **Authorized redirect URIs**:
  ```
  https://kzlgfyzsaksichdeivcs.supabase.co/auth/v1/callback
  ```

### 3. Konfigurasi URL di Supabase

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:8000`
- **Redirect URLs**: tambahkan `http://localhost:8000` dan `http://localhost:8000/**`

> **Penting:** kalau login gagal, cek dulu Redirect URLs di atas. Ini penyebab
> paling umum — Google berhasil login tapi Supabase menolak redirect balik.

## Pengembangan Selanjutnya

- [ ] Authentication dengan Supabase Auth
- [ ] Riwayat absensi dengan filter tanggal
- [ ] Export data ke Excel/PDF
- [ ] Notifikasi reminder check-in/out
- [ ] Dashboard statistik kehadiran
- [ ] Multi-user support dengan role management

## License

[MIT](LICENSE) © 2026 coderdy-git
