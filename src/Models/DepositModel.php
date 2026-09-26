<?php

namespace App\Models;

use App\Config\Database;

class DepositModel
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /**
     * Saldo deposit = total setor - total terpakai.
     *
     * Dihitung dari mutasi, bukan disimpan di kolom, supaya tidak
     * mungkin tidak sinkron dengan riwayatnya.
     */
    public function getBalance(string $contactId): float
    {
        $endpoint = 'deposits?contact_id=eq.' . $contactId
            . '&is_void=eq.false'
            . '&select=type,amount';

        $result = $this->db->request($endpoint);
        $rows = $result['data'] ?? [];

        $balance = 0.0;
        foreach ($rows as $row) {
            $amount = (float) $row['amount'];
            $balance += $row['type'] === 'in' ? $amount : -$amount;
        }

        return $balance;
    }

    /**
     * Riwayat mutasi deposit, terbaru di atas.
     */
    public function getHistory(string $contactId, int $limit = 50): array
    {
        $endpoint = 'deposits?contact_id=eq.' . $contactId
            . '&is_void=eq.false'
            . '&order=date.desc,created_at.desc'
            . '&limit=' . $limit;

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Catat setoran deposit manual.
     */
    public function create(string $contactId, array $input): array
    {
        $amount = $this->parseAmount($input['amount'] ?? '');

        if ($amount === null || $amount <= 0) {
            return ['success' => false, 'message' => 'Nilai setoran harus lebih dari 0'];
        }

        $data = [
            'contact_id' => $contactId,
            'type'       => 'in',
            'amount'     => $amount,
            'date'       => $this->parseDate($input['date'] ?? ''),
            'notes'      => trim($input['notes'] ?? '') ?: null,
        ];

        $result = $this->db->request('deposits', 'POST', $data);

        if ($result['status'] === 201) {
            return [
                'success' => true,
                'message' => 'Setoran deposit berhasil dicatat',
                'data'    => $result['data'][0] ?? null,
            ];
        }

        return ['success' => false, 'message' => 'Gagal mencatat setoran'];
    }

    /**
     * Batalkan mutasi deposit (void).
     *
     * Untuk mutasi 'in', pembatalan tidak boleh membuat saldo jadi
     * minus — itu berarti depositnya sudah terpakai untuk piutang.
     */
    public function void(string $userId, string $id): array
    {
        $existing = $this->findOwned($userId, $id);
        if ($existing === null) {
            return ['success' => false, 'message' => 'Mutasi tidak ditemukan'];
        }

        if ($existing['type'] === 'in') {
            $balance = $this->getBalance($existing['contact_id']);
            if ($balance - (float) $existing['amount'] < 0) {
                return [
                    'success' => false,
                    'message' => 'Tidak bisa dibatalkan, depositnya sudah terpakai untuk piutang',
                ];
            }
        }

        $endpoint = 'deposits?id=eq.' . $id;
        $result = $this->db->request($endpoint, 'PATCH', ['is_void' => true]);

        if ($result['status'] === 200) {
            return ['success' => true, 'message' => 'Mutasi deposit dibatalkan'];
        }

        return ['success' => false, 'message' => 'Gagal membatalkan mutasi'];
    }

    /**
     * Ambil mutasi, pastikan kontaknya milik user ini.
     */
    public function findOwned(string $userId, string $id): ?array
    {
        $endpoint = 'deposits?select=*,contacts!inner(user_id)'
            . '&id=eq.' . $id
            . '&contacts.user_id=eq.' . $userId
            . '&limit=1';

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return $data[0] ?? null;
    }

    private function parseAmount($raw): ?float
    {
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
}
