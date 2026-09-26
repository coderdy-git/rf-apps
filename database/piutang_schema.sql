-- ============================================================
-- Buku Piutang — skema tabel
-- Jalankan di Supabase SQL Editor.
--
-- Konsep:
--   Piutang  = orang berhutang ke kita (aset kita)
--   Deposit  = orang menitipkan uang ke kita (kewajiban kita)
--
-- Pembayaran selalu melunasi piutang secara penuh. Kalau uang
-- kurang, piutang itu tidak boleh dicentang. Deposit dipotong
-- otomatis sebelum tunai, dan kelebihan tunai masuk deposit.
--
-- Tidak ada baris yang dihapus permanen. Pembatalan memakai
-- kolom is_void supaya jejak perubahan tetap bisa ditelusuri.
-- ============================================================

-- ------------------------------------------------------------
-- 1. contacts — daftar orang/pelanggan
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    name        VARCHAR(100) NOT NULL,
    phone       VARCHAR(30),
    notes       TEXT,
    is_void     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user   ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name   ON contacts(user_id, name);

-- Nama kontak tidak boleh duplikat dalam satu user (yang tidak void)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_user_name
    ON contacts(user_id, LOWER(name))
    WHERE is_void = FALSE;

-- ------------------------------------------------------------
-- 2. receivables — piutang
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receivables (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    description  VARCHAR(200) NOT NULL,
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    date         DATE NOT NULL DEFAULT CURRENT_DATE,
    notes        TEXT,
    is_settled   BOOLEAN NOT NULL DEFAULT FALSE,
    settled_at   TIMESTAMPTZ,
    is_void      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivables_contact ON receivables(contact_id);
CREATE INDEX IF NOT EXISTS idx_receivables_open
    ON receivables(contact_id)
    WHERE is_settled = FALSE AND is_void = FALSE;

-- ------------------------------------------------------------
-- 3. payments — induk transaksi pembayaran
-- ------------------------------------------------------------
-- Satu aksi bayar = satu baris di sini, dengan satu atau lebih
-- rincian di payment_items.
--
-- total_amount  = jumlah nilai piutang yang dilunasi
-- deposit_used  = berapa yang diambil dari saldo deposit
-- cash_amount   = uang tunai yang diterima
-- (cash_amount - (total_amount - deposit_used)) = kelebihan,
-- yang otomatis dicatat sebagai deposits type 'in'
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    date          DATE NOT NULL DEFAULT CURRENT_DATE,
    total_amount  NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
    deposit_used  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit_used >= 0),
    cash_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
    notes         TEXT,
    is_void       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_contact ON payments(contact_id);

-- ------------------------------------------------------------
-- 4. deposits — mutasi deposit (saldo dihitung, tidak disimpan)
-- ------------------------------------------------------------
-- type:
--   'in'      setor manual, atau kelebihan bayar tunai
--   'applied' dipotong untuk melunasi piutang
--
-- Saldo = SUM(amount WHERE type='in' AND NOT is_void)
--       - SUM(amount WHERE type='applied' AND NOT is_void)
-- ------------------------------------------------------------
-- payment_id menandai mutasi yang lahir dari transaksi pembayaran.
-- Diisi hanya untuk type 'applied' dan kelebihan bayar, supaya saat
-- transaksi dibatalkan, mutasi mana yang harus ikut batal bisa
-- ditentukan dengan pasti — bukan dengan menebak dari catatan/tanggal.
--
-- Didefinisikan setelah payments karena mereferensinya.
CREATE TABLE IF NOT EXISTS deposits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type        VARCHAR(10) NOT NULL CHECK (type IN ('in', 'applied')),
    amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    date        DATE NOT NULL DEFAULT CURRENT_DATE,
    notes       TEXT,
    payment_id  UUID REFERENCES payments(id) ON DELETE SET NULL,
    is_void     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_contact ON deposits(contact_id);
CREATE INDEX IF NOT EXISTS idx_deposits_payment ON deposits(payment_id);

-- ------------------------------------------------------------
-- 5. payment_items — rincian: piutang mana saja yang dilunasi
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id     UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    receivable_id  UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Satu piutang hanya boleh dilunasi sekali per transaksi
    CONSTRAINT uniq_payment_receivable UNIQUE (payment_id, receivable_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_items_payment    ON payment_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_receivable ON payment_items(receivable_id);

-- ------------------------------------------------------------
-- 6. Trigger updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts;
CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_receivables_updated_at ON receivables;
CREATE TRIGGER trg_receivables_updated_at
    BEFORE UPDATE ON receivables
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 7. View bantu — ringkasan saldo per kontak
-- ------------------------------------------------------------
-- Dipakai halaman daftar kontak supaya tidak perlu hitung di PHP.
-- security_invoker supaya RLS tetap berlaku untuk user pemanggil.
CREATE OR REPLACE VIEW contact_summary
WITH (security_invoker = true) AS
SELECT
    c.id,
    c.user_id,
    c.name,
    c.phone,
    c.notes,
    COALESCE((
        SELECT SUM(r.amount)
        FROM receivables r
        WHERE r.contact_id = c.id
          AND r.is_settled = FALSE
          AND r.is_void = FALSE
    ), 0) AS outstanding_total,
    COALESCE((
        SELECT SUM(CASE WHEN d.type = 'in' THEN d.amount ELSE -d.amount END)
        FROM deposits d
        WHERE d.contact_id = c.id
          AND d.is_void = FALSE
    ), 0) AS deposit_balance
FROM contacts c
WHERE c.is_void = FALSE;

-- ------------------------------------------------------------
-- 8. Row Level Security
-- ------------------------------------------------------------
-- Semua tabel memakai pola yang sama seperti absensi:
-- user hanya melihat dan mengubah barisnya sendiri, uid diambil
-- dari token Supabase Auth yang diteruskan backend.

ALTER TABLE contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_items ENABLE ROW LEVEL SECURITY;

-- contacts: pemilik langsung
DROP POLICY IF EXISTS "contacts_select_own" ON contacts;
CREATE POLICY "contacts_select_own" ON contacts FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_insert_own" ON contacts;
CREATE POLICY "contacts_insert_own" ON contacts FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_update_own" ON contacts;
CREATE POLICY "contacts_update_own" ON contacts FOR UPDATE TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- receivables: kepemilikan lewat kontak
DROP POLICY IF EXISTS "receivables_select_own" ON receivables;
CREATE POLICY "receivables_select_own" ON receivables FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "receivables_insert_own" ON receivables;
CREATE POLICY "receivables_insert_own" ON receivables FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "receivables_update_own" ON receivables;
CREATE POLICY "receivables_update_own" ON receivables FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

-- deposits: kepemilikan lewat kontak
DROP POLICY IF EXISTS "deposits_select_own" ON deposits;
CREATE POLICY "deposits_select_own" ON deposits FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "deposits_insert_own" ON deposits;
CREATE POLICY "deposits_insert_own" ON deposits FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "deposits_update_own" ON deposits;
CREATE POLICY "deposits_update_own" ON deposits FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

-- payments: kepemilikan lewat kontak
DROP POLICY IF EXISTS "payments_select_own" ON payments;
CREATE POLICY "payments_select_own" ON payments FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "payments_insert_own" ON payments;
CREATE POLICY "payments_insert_own" ON payments FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "payments_update_own" ON payments;
CREATE POLICY "payments_update_own" ON payments FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.user_id = auth.uid()
    ));

-- payment_items: kepemilikan lewat payment
DROP POLICY IF EXISTS "payment_items_select_own" ON payment_items;
CREATE POLICY "payment_items_select_own" ON payment_items FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM payments p
        JOIN contacts c ON c.id = p.contact_id
        WHERE p.id = payment_id AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "payment_items_insert_own" ON payment_items;
CREATE POLICY "payment_items_insert_own" ON payment_items FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM payments p
        JOIN contacts c ON c.id = p.contact_id
        WHERE p.id = payment_id AND c.user_id = auth.uid()
    ));
