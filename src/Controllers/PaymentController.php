<?php

namespace App\Controllers;

use App\Models\ContactModel;
use App\Models\PaymentModel;

class PaymentController extends BaseController
{
    private PaymentModel $paymentModel;
    private ContactModel $contactModel;

    public function __construct()
    {
        parent::__construct();
        $this->paymentModel = new PaymentModel($this->db);
        $this->contactModel = new ContactModel($this->db);
    }

    /**
     * GET /api/contacts/{id}/payments — riwayat transaksi pembayaran
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

        return ['success' => true, 'data' => $this->paymentModel->getByContact($contactId)];
    }

    /**
     * POST /api/contacts/{id}/payments/preview
     *
     * Hitung pratinjau: total piutang dipilih, potong deposit, sisa tunai.
     * Dipakai frontend untuk menampilkan angka berjalan sebelum disimpan.
     */
    public function preview(string $contactId): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated', 'data' => null];
        }

        if ($this->contactModel->findOwned($userId, $contactId) === null) {
            return ['success' => false, 'message' => 'Kontak tidak ditemukan', 'data' => null];
        }

        $input = $this->jsonInput();
        $ids = $input['receivable_ids'] ?? [];

        if (!is_array($ids)) {
            return ['success' => false, 'message' => 'Daftar piutang tidak valid', 'data' => null];
        }

        $preview = $this->paymentModel->preview($contactId, $ids);

        if ($preview === null) {
            return [
                'success' => false,
                'message' => 'Ada piutang yang sudah lunas atau tidak ditemukan',
                'data'    => null,
            ];
        }

        return ['success' => true, 'data' => $preview];
    }

    /**
     * POST /api/contacts/{id}/payments — simpan transaksi pembayaran
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

        return $this->paymentModel->create($contactId, $this->jsonInput());
    }

    /**
     * DELETE /api/payments/{id} — batalkan transaksi
     */
    public function destroy(string $id): array
    {
        $userId = $this->getCurrentUserId();
        if ($userId === null) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        return $this->paymentModel->void($userId, $id);
    }
}
