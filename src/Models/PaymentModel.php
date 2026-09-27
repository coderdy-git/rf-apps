<?php

namespace App\Models;

use App\Config\Database;

class PaymentModel
{
    private Database $db;
    private DepositModel $depositModel;

    public function __construct(Database $db)
    {
        $this->db = $db;
        $this->depositModel = new DepositModel($db);
    }

    /**
     * Pratinjau perhitungan sebelum user menekan Simpan.
     *
     * Dipakai frontend untuk menampilkan tiga angka berjalan:
     *   total piutang dipilih / potong deposit / sisa tunai
     *
     * $receivableIds = piutang yang dicentang user.
     * Mengembalikan null kalau ada piutang yang tidak valid.
     */
    public function preview(string $contactId, array $receivableIds): ?array
    {
        if (empty($receivableIds)) {
            return [
                'total'         => 0.0,
                'deposit_used'  => 0.0,
                'cash_required' => 0.0,
                'deposit_balance' => $this->depositModel->getBalance($contactId),
                'items'         => [],
            ];
        }

        $items = $this->fetchOpenReceivables($contactId, $receivableIds);

        // Jumlah piutang yang diminta harus sama dengan yang ditemukan —
        // kalau kurang, berarti ada yang sudah lunas atau bukan milik kontak ini.
        if (count($items) !== count(array_unique($receivableIds))) {
            return null;
        }

        $total = 0.0;
        foreach ($items as $item) {
            $total += (float) $item['amount'];
        }

        $balance = $this->depositModel->getBalance($contactId);
        $depositUsed = min($balance, $total);
        $cashRequired = $total - $depositUsed;

        return [
            'total'           => $total,
            'deposit_used'    => $depositUsed,
            'cash_required'   => $cashRequired,
            'deposit_balance' => $balance,
            'items'           => $items,
        ];
    }

    /**
     * Simpan transaksi pembayaran.
     *
     * Urutan penulisan penting: kalau salah satu langkah gagal di tengah,
     * data bisa setengah jadi. Karena PostgREST tidak mendukung transaksi
     * lintas tabel, kegagalan di langkah lanjutan dibatalkan manual dengan
     * menandai is_void pada baris yang sudah terlanjur ditulis.
     */
    public function create(string $contactId, array $input): array
    {
        $receivableIds = $input['receivable_ids'] ?? [];
        if (!is_array($receivableIds) || empty($receivableIds)) {
            return ['success' => false, 'message' => 'Pilih minimal satu piutang'];
        }

        $preview = $this->preview($contactId, $receivableIds);
        if ($preview === null) {
            return [
                'success' => false,
                'message' => 'Ada piutang yang sudah lunas atau tidak ditemukan. Muat ulang halaman.',
            ];
        }

        $cashInput = $this->parseAmount($input['cash_amount'] ?? 0);
        if ($cashInput === null || $cashInput < 0) {
            return ['success' => false, 'message' => 'Nominal tunai tidak valid'];
        }

        // Tunai harus menutup sisa setelah potong deposit.
        if ($cashInput < $preview['cash_required']) {
            return [
                'success' => false,
                'message' => sprintf(
                    'Uang tunai kurang %s dari yang dibutuhkan',
                    $this->formatRupiah($preview['cash_required'] - $cashInput)
                ),
            ];
        }

        $excess = $cashInput - $preview['cash_required'];
        $date = $this->parseDate($input['date'] ?? '');

        // --- 1. Induk transaksi ---
        $payment = $this->db->request('payments', 'POST', [
            'contact_id'   => $contactId,
            'date'         => $date,
            'total_amount' => $preview['total'],
            'deposit_used' => $preview['deposit_used'],
            'cash_amount'  => $cashInput,
            'notes'        => trim($input['notes'] ?? '') ?: null,
        ]);

        if ($payment['status'] !== 201) {
            return ['success' => false, 'message' => 'Gagal menyimpan transaksi pembayaran'];
        }

        $paymentId = $payment['data'][0]['id'];

        // --- 2. Rincian per piutang ---
        $items = [];
        foreach ($preview['items'] as $item) {
            $items[] = [
                'payment_id'    => $paymentId,
                'receivable_id' => $item['id'],
                'amount'        => $item['amount'],
            ];
        }

        $itemResult = $this->db->request('payment_items', 'POST', $items);
        if ($itemResult['status'] !== 201) {
            $this->db->request('payments?id=eq.' . $paymentId, 'PATCH', ['is_void' => true]);

            return ['success' => false, 'message' => 'Gagal menyimpan rincian pembayaran'];
        }

        // --- 3. Tandai piutang lunas ---
        $settledAt = date('Y-m-d H:i:sP');
        foreach ($preview['items'] as $item) {
            $update = $this->db->request(
                'receivables?id=eq.' . $item['id'],
                'PATCH',
                ['is_settled' => true, 'settled_at' => $settledAt]
            );

            if ($update['status'] !== 200) {
                $this->rollback($paymentId, $preview['items']);
                return ['success' => false, 'message' => 'Gagal menandai piutang lunas'];
            }
        }

        // --- 4. Catat pemakaian deposit ---
        if ($preview['deposit_used'] > 0) {
            $applied = $this->db->request('deposits', 'POST', [
                'contact_id' => $contactId,
                'type'       => 'applied',
                'amount'     => $preview['deposit_used'],
                'date'       => $date,
                'notes'      => 'Potong piutang',
                'payment_id' => $paymentId,
            ]);

            if ($applied['status'] !== 201) {
                $this->rollback($paymentId, $preview['items']);
                return ['success' => false, 'message' => 'Gagal mencatat pemakaian deposit'];
            }
        }

        // --- 5. Kelebihan tunai masuk deposit ---
        if ($excess > 0) {
            $in = $this->db->request('deposits', 'POST', [
                'contact_id' => $contactId,
                'type'       => 'in',
                'amount'     => $excess,
                'date'       => $date,
                'notes'      => 'Kelebihan bayar',
                'payment_id' => $paymentId,
            ]);

            // Kelebihan gagal dicatat tidak membatalkan seluruh transaksi —
            // piutang sudah lunas dan itu yang utama. Dilaporkan sebagai
            // peringatan supaya user bisa catat manual kalau perlu.
            if ($in['status'] !== 201) {
                return [
                    'success' => true,
                    'message' => 'Pembayaran tersimpan, tapi kelebihan tunai gagal dicatat sebagai deposit',
                    'warning' => true,
                ];
            }
        }

        return [
            'success' => true,
            'message' => sprintf('Berhasil melunasi %d piutang', count($preview['items'])),
            'data'    => [
                'payment_id'   => $paymentId,
                'total'        => $preview['total'],
                'deposit_used' => $preview['deposit_used'],
                'cash_amount'  => $cashInput,
                'excess'       => $excess,
            ],
        ];
    }

    /**
     * Batalkan transaksi pembayaran.
     *
     * Mengembalikan piutang jadi belum lunas, dan membatalkan mutasi
     * deposit yang terkait supaya saldo kembali seperti semula.
     */
    public function void(string $userId, string $paymentId): array
    {
        $payment = $this->findOwned($userId, $paymentId);
        if ($payment === null) {
            return ['success' => false, 'message' => 'Transaksi tidak ditemukan'];
        }

        if (!empty($payment['is_void'])) {
            return ['success' => false, 'message' => 'Transaksi sudah dibatalkan'];
        }

        $contactId = $payment['contact_id'];

        // Piutang yang dilunasi transaksi ini
        $itemsResult = $this->db->request(
            'payment_items?payment_id=eq.' . $paymentId . '&select=receivable_id,amount'
        );
        $items = $itemsResult['data'] ?? [];

        // Buka kembali piutangnya
        foreach ($items as $item) {
            $this->db->request(
                'receivables?id=eq.' . $item['receivable_id'],
                'PATCH',
                ['is_settled' => false, 'settled_at' => null]
            );
        }

        // Batalkan mutasi deposit yang lahir dari transaksi ini.
        // Ditelusuri lewat payment_id, bukan dari catatan atau tanggal,
        // supaya transaksi lain di hari yang sama tidak ikut terbawa.
        $depositResult = $this->db->request(
            'deposits?payment_id=eq.' . $paymentId . '&is_void=eq.false&select=id'
        );

        foreach ($depositResult['data'] ?? [] as $row) {
            $this->db->request('deposits?id=eq.' . $row['id'], 'PATCH', ['is_void' => true]);
        }

        // Tandai transaksinya batal
        $result = $this->db->request(
            'payments?id=eq.' . $paymentId,
            'PATCH',
            ['is_void' => true]
        );

        if ($result['status'] !== 200) {
            return ['success' => false, 'message' => 'Gagal membatalkan transaksi'];
        }

        return ['success' => true, 'message' => 'Transaksi pembayaran dibatalkan'];
    }

    /**
     * Riwayat transaksi pembayaran satu kontak.
     */
    public function getByContact(string $contactId, int $limit = 50): array
    {
        $endpoint = 'payments?contact_id=eq.' . $contactId
            . '&is_void=eq.false'
            . '&order=date.desc,created_at.desc'
            . '&limit=' . $limit;

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    public function findOwned(string $userId, string $id): ?array
    {
        $endpoint = 'payments?select=*,contacts!inner(user_id)'
            . '&id=eq.' . $id
            . '&contacts.user_id=eq.' . $userId
            . '&limit=1';

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return $data[0] ?? null;
    }

    /**
     * Ambil piutang yang masih terbuka, dibatasi ke id yang diminta.
     */
    private function fetchOpenReceivables(string $contactId, array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if (empty($ids)) {
            return [];
        }

        $endpoint = 'receivables?contact_id=eq.' . $contactId
            . '&is_settled=eq.false'
            . '&is_void=eq.false'
            . '&id=in.(' . implode(',', $ids) . ')'
            . '&order=date.asc';

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Kembalikan keadaan kalau ada langkah yang gagal di tengah jalan.
     */
    private function rollback(string $paymentId, array $items): void
    {
        foreach ($items as $item) {
            $this->db->request(
                'receivables?id=eq.' . $item['id'],
                'PATCH',
                ['is_settled' => false, 'settled_at' => null]
            );
        }

        $this->db->request('payments?id=eq.' . $paymentId, 'PATCH', ['is_void' => true]);
    }

    private function parseAmount($raw): ?float
    {
        if ($raw === null || $raw === '') {
            return 0.0;
        }
        if (is_numeric($raw)) {
            return (float) $raw;
        }

        $cleaned = str_replace(['.', ',', ' ', 'Rp'], '', (string) $raw);

        return is_numeric($cleaned) ? (float) $cleaned : null;
    }

    private function parseDate($raw): string
    {
        $raw = trim((string) $raw);
        $date = \DateTime::createFromFormat('Y-m-d', $raw);

        if ($date && $date->format('Y-m-d') === $raw) {
            return $raw;
        }

        return date('Y-m-d');
    }

    private function formatRupiah(float $n): string
    {
        return 'Rp ' . number_format($n, 0, ',', '.');
    }
}
