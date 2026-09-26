<?php

namespace App\Controllers;

use App\Models\ContactModel;
use App\Models\DepositModel;

class DepositController extends BaseController
{
    private DepositModel $depositModel;
    private ContactModel $contactModel;

    public function __construct()
    {
        parent::__construct();
        $this->depositModel = new DepositModel($this->db);
        $this->contactModel = new ContactModel($this->db);
    }

    /**
     * GET /api/contacts/{id}/deposits — riwayat mutasi deposit
     */
    public function index(string $contactId): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated', 'data' => []];
        }

        if ($this->contactModel->findOwned($userId, $contactId) === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan', 'data' => []];
        }

        return [
            'success' => true,
            'data' => [
                'balance' => $this->depositModel->getBalance($contactId),
                'history' => $this->depositModel->getHistory($contactId),
            ],
        ];
    }

    /**
     * POST /api/contacts/{id}/deposits — catat setoran
     */
    public function store(string $contactId): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        if ($this->contactModel->findOwned($userId, $contactId) === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan'];
        }

        return $this->depositModel->create($contactId, $this->jsonInput());
    }

    /**
     * DELETE /api/deposits/{id} — batalkan mutasi (void)
     */
    public function destroy(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->depositModel->void($userId, $id);
    }
}
