<?php

namespace App\Models;

use App\Config\Database;

class ContactModel
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /**
     * Daftar kontak beserta ringkasan saldo.
     *
     * contact_summary sudah menghitung total piutang aktif dan saldo
     * deposit di sisi database, jadi PHP tidak perlu agregasi manual.
     */
    public function getAll(string $userId, string $search = ''): array
    {
        $endpoint = 'contact_summary?user_id=eq.' . $userId
            . '&order=name.asc';

        if ($search !== '') {
            // ilike = case-insensitive; tanda * adalah wildcard PostgREST
            $endpoint .= '&name=ilike.*' . rawurlencode($search) . '*';
        }

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Satu kontak beserta ringkasannya.
     */
    public function getById(string $userId, string $id): ?array
    {
        $endpoint = 'contact_summary?user_id=eq.' . $userId . '&id=eq.' . $id . '&limit=1';

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return $data[0] ?? null;
    }

    /**
     * Kontak milik user, tanpa ringkasan saldo.
     * Dipakai untuk validasi kepemilikan sebelum mengubah data terkait.
     */
    public function findOwned(string $userId, string $id): ?array
    {
        $endpoint = 'contacts?user_id=eq.' . $userId
            . '&id=eq.' . $id
            . '&is_void=eq.false&limit=1';

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return $data[0] ?? null;
    }

    public function create(string $userId, array $input): array
    {
        $name = trim($input['name'] ?? '');

        if ($name === '') {
            return ['success' => false, 'message' => 'Nama kontak wajib diisi'];
        }

        $data = [
            'user_id' => $userId,
            'name'    => $name,
            'phone'   => trim($input['phone'] ?? '') ?: null,
            'notes'   => trim($input['notes'] ?? '') ?: null,
        ];

        $result = $this->db->request('contacts', 'POST', $data);

        if ($result['status'] === 201) {
            return [
                'success' => true,
                'message' => 'Kontak berhasil ditambahkan',
                'data'    => $result['data'][0] ?? null,
            ];
        }

        return [
            'success' => false,
            'message' => $this->friendlyError($result['data']),
        ];
    }

    public function update(string $userId, string $id, array $input): array
    {
        $existing = $this->findOwned($userId, $id);
        if ($existing === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan'];
        }

        $name = trim($input['name'] ?? '');
        if ($name === '') {
            return ['success' => false, 'message' => 'Nama kontak wajib diisi'];
        }

        $data = [
            'name'  => $name,
            'phone' => trim($input['phone'] ?? '') ?: null,
            'notes' => trim($input['notes'] ?? '') ?: null,
        ];

        $endpoint = 'contacts?user_id=eq.' . $userId . '&id=eq.' . $id;
        $result = $this->db->request($endpoint, 'PATCH', $data);

        if ($result['status'] === 200) {
            return [
                'success' => true,
                'message' => 'Kontak berhasil diperbarui',
                'data'    => $result['data'][0] ?? null,
            ];
        }

        return [
            'success' => false,
            'message' => $this->friendlyError($result['data']),
        ];
    }

    /**
     * Batalkan kontak (void), bukan hapus permanen.
     */
    public function void(string $userId, string $id): array
    {
        $existing = $this->findOwned($userId, $id);
        if ($existing === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan'];
        }

        $endpoint = 'contacts?user_id=eq.' . $userId . '&id=eq.' . $id;
        $result = $this->db->request($endpoint, 'PATCH', [
            'is_void' => true,
        ]);

        if ($result['status'] === 200) {
            return ['success' => true, 'message' => 'Kontak berhasil dibatalkan'];
        }

        return ['success' => false, 'message' => 'Gagal membatalkan kontak'];
    }

    /**
     * Terjemahkan error Postgres ke pesan yang bisa dimengerti user.
     */
    private function friendlyError(array $error): string
    {
        $code = $error['code'] ?? '';

        // 23505 = unique violation, dari uniq_contacts_user_name
        if ($code === '23505') {
            return 'Nama kontak sudah dipakai';
        }

        return 'Gagal menyimpan kontak';
    }
}
