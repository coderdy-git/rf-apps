<?php

namespace App\Controllers;

use App\Models\ContactModel;
use App\Models\ReceivableModel;

class ReceivableController extends BaseController
{
    private ReceivableModel $receivableModel;
    private ContactModel $contactModel;

    public function __construct()
    {
        parent::__construct();
        $this->receivableModel = new ReceivableModel($this->db);
        $this->contactModel = new ContactModel($this->db);
    }

    /**
     * POST /api/receivables — tambah piutang
     */
    public function store(): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        $input = $this->jsonInput();

        // Pastikan kontaknya memang milik user ini. RLS juga menolak,
        // tapi pesannya jadi lebih jelas kalau dicek lebih dulu.
        $contactId = trim($input['contact_id'] ?? '');
        if ($this->contactModel->findOwned($userId, $contactId) === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan'];
        }

        return $this->receivableModel->create($input);
    }

    /**
     * PATCH /api/receivables/{id} — ubah piutang
     */
    public function update(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->receivableModel->update($userId, $id, $this->jsonInput());
    }

    /**
     * DELETE /api/receivables/{id} — batalkan piutang (void)
     */
    public function destroy(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->receivableModel->void($userId, $id);
    }
}
