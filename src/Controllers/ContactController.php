<?php

namespace App\Controllers;

use App\Models\ContactModel;
use App\Models\ReceivableModel;

class ContactController extends BaseController
{
    private ContactModel $contactModel;
    private ReceivableModel $receivableModel;

    public function __construct()
    {
        parent::__construct();
        $this->contactModel = new ContactModel($this->db);
        $this->receivableModel = new ReceivableModel($this->db);
    }

    /**
     * GET /api/contacts  — daftar kontak
     * GET /api/contacts?search=budi
     */
    public function index(): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated', 'data' => []];
        }

        $search = trim($_GET['search'] ?? '');
        $contacts = $this->contactModel->getAll($userId, $search);

        return ['success' => true, 'data' => $contacts];
    }

    /**
     * GET /api/contacts/{id} — detail kontak + piutang aktif + riwayat
     */
    public function show(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated', 'data' => null];
        }

        $contact = $this->contactModel->getById($userId, $id);
        if ($contact === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan', 'data' => null];
        }

        return [
            'success' => true,
            'data' => [
                'contact' => $contact,
                'receivables' => $this->receivableModel->getByContact($id),
            ],
        ];
    }

    /**
     * POST /api/contacts — tambah kontak
     */
    public function store(): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->contactModel->create($userId, $this->jsonInput());
    }

    /**
     * PATCH /api/contacts/{id} — ubah kontak
     */
    public function update(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->contactModel->update($userId, $id, $this->jsonInput());
    }

    /**
     * DELETE /api/contacts/{id} — batalkan kontak (void, bukan hapus)
     */
    public function destroy(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->contactModel->void($userId, $id);
    }
}
