<?php

namespace App\Controllers;

use App\Config\Database;

/**
 * Menangani autentikasi lewat token Supabase Auth.
 *
 * Semua controller mewarisi ini supaya logika token hanya ada di satu
 * tempat — kalau nanti cara auth berubah, cukup diubah di sini.
 */
abstract class BaseController
{
    protected Database $db;

    private ?string $userId = null;
    private bool $authAttempted = false;

    public function __construct()
    {
        $this->db = new Database();
    }

    /**
     * Verifikasi token, lalu teruskan ke Database supaya RLS
     * dievaluasi sebagai user yang sedang login.
     */
    protected function authenticate(): bool
    {
        if ($this->authAttempted) {
            return $this->userId !== null;
        }
        $this->authAttempted = true;

        $token = $this->bearerToken();
        if ($token === null) {
            return false;
        }

        $user = $this->db->getUser($token);
        if ($user === null) {
            return false;
        }

        $this->db->setAccessToken($token);
        $this->userId = $user['id'];

        return true;
    }

    /**
     * Ambil user ID, atau null kalau token tidak valid.
     */
    protected function getCurrentUserId(): ?string
    {
        $this->authenticate();

        return $this->userId;
    }

    /**
     * Baca body JSON dari request.
     */
    protected function jsonInput(): array
    {
        $raw = file_get_contents('php://input');

        if ($raw === false || $raw === '') {
            return $_POST;
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Ambil token dari header Authorization.
     *
     * Beberapa setup hosting menyembunyikan header ini dari PHP, jadi
     * ada beberapa sumber yang dicoba sebelum menyerah.
     */
    private function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';

        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $name => $value) {
                if (strcasecmp($name, 'Authorization') === 0) {
                    $header = $value;
                    break;
                }
            }
        }

        if (stripos($header, 'Bearer ') === 0) {
            return substr($header, 7);
        }

        return null;
    }
}
