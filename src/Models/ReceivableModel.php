<?php

namespace App\Models;

use App\Config\Database;

class ReceivableModel
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /**
     * Piutang milik satu kontak.
     * Secara default hanya yang masih aktif (belum lunas, belum void).
     */
    public function getByContact(string $contactId, bool $includeSettled = false): array
    {
        $endpoint = 'receivables?contact_id=eq.' . $contactId
            . '&is_void=eq.false';

        if (!$includeSettled) {
            $endpoint .= '&is_settled=eq.false';
        }

        $endpoint .= '&order=date.asc,created_at.asc';

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Ambil piutang milik user tertentu (dicek lewat kontak).
     */
    public function findOwned(string $userId, string $id): ?array
    {
        $endpoint = 'receivables?select=*,contacts!inner(user_id)'
            . '&id=eq.' . $id
            . '&contacts.user_id=eq.' . $userId
            . '&limit=1';

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return $data[0] ?? null;
    }

    public function create(array $input): array
    {
        $contactId   = trim($input['contact_id'] ?? '');
        $description = trim($input['description'] ?? '');
        $amount      = $this->parseAmount($input['amount'] ?? '');

        if ($contactId === '') {
            return ['success' => false, 'message' => 'Kontak tidak valid'];
        }
        if ($description === '') {
            return ['success' => false, 'message' => 'Keterangan wajib diisi'];
        }
        if ($amount === null || $amount <= 0) {
            return ['success' => false, 'message' => 'Nilai piutang harus lebih dari 0'];
        }

        $data = [
            'contact_id'  => $contactId,
            'description' => $description,
            'amount'      => $amount,
            'date'        => $this->parseDate($input['date'] ?? ''),
            'notes'       => trim($input['notes'] ?? '') ?: null,
        ];

        $result = $this->db->request('receivables', 'POST', $data);

        if ($result['status'] === 201) {
            return [
                'success' => true,
                'message' => 'Piutang berhasil ditambahkan',
                'data'    => $result['data'][0] ?? null,
            ];
        }

        return ['success' => false, 'message' => 'Gagal menyimpan piutang'];
    }

    public function update(string $userId, string $id, array $input): array
    {
        $existing = $this->findOwned($userId, $id);
        if ($existing === null) {
            return ['success' => false, 'message' => 'Piutang tidak ditemukan'];
        }

        // Piutang yang sudah lunas tidak boleh diubah — nilainya sudah
        // dipakai sebagai dasar transaksi pembayaran.
        if (!empty($existing['is_settled'])) {
            return [
                'success' => false,
                'message' => 'Piutang yang sudah lunas tidak bisa diubah',
            ];
        }

        $description = trim($input['description'] ?? '');
        $amount      = $this->parseAmount($input['amount'] ?? '');

        if ($description === '') {
            return ['success' => false, 'message' => 'Keterangan wajib diisi'];
        }
        if ($amount === null || $amount <= 0) {
            return ['success' => false, 'message' => 'Nilai piutang harus lebih dari 0'];
        }

        $data = [
            'description' => $description,
            'amount'      => $amount,
            'date'        => $this->parseDate($input['date'] ?? ''),
            'notes'       => trim($input['notes'] ?? '') ?: null,
        ];

        $endpoint = 'receivables?id=eq.' . $id;
        $result = $this->db->request($endpoint, 'PATCH', $data);

        if ($result['status'] === 200) {
            return [
                'success' => true,
                'message' => 'Piutang berhasil diperbarui',
                'data'    => $result['data'][0] ?? null,
            ];
        }

        return ['success' => false, 'message' => 'Gagal memperbarui piutang'];
    }

    /**
     * Batalkan piutang (void), bukan hapus permanen.
     */
    public function void(string $userId, string $id): array
    {
        $existing = $this->findOwned($userId, $id);
        if ($existing === null) {
            return ['success' => false, 'message' => 'Piutang tidak ditemukan'];
        }

        if (!empty($existing['is_settled'])) {
            return [
                'success' => false,
                'message' => 'Piutang yang sudah lunas tidak bisa dibatalkan',
            ];
        }

        $endpoint = 'receivables?id=eq.' . $id;
        $result = $this->db->request($endpoint, 'PATCH', ['is_void' => true]);

        if ($result['status'] === 200) {
            return ['success' => true, 'message' => 'Piutang berhasil dibatalkan'];
        }

        return ['success' => false, 'message' => 'Gagal membatalkan piutang'];
    }

    /**
     * Terima angka dari input user: "1.500.000", "1500000", "1500000.50".
     * Mengembalikan null kalau bukan angka yang valid.
     */
    private function parseAmount($raw): ?float
    {
        if (is_numeric($raw)) {
            return (float) $raw;
        }

        $cleaned = str_replace(['.', ',', ' ', 'Rp'], '', (string) $raw);

        return is_numeric($cleaned) ? (float) $cleaned : null;
    }

    /**
     * Pakai tanggal dari input kalau valid, kalau tidak pakai hari ini.
     */
    private function parseDate($raw): string
    {
        $raw = trim((string) $raw);

        $date = \DateTime::createFromFormat('Y-m-d', $raw);
        if ($date && $date->format('Y-m-d') === $raw) {
            return $raw;
        }

        return date('Y-m-d');
    }
}
