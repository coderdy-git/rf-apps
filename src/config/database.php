<?php

namespace App\Config;

class Database
{
    private string $supabaseUrl;
    private string $supabaseKey;
    private ?string $accessToken = null;

    public function __construct()
    {
        $this->supabaseUrl = $_ENV['SUPABASE_URL'] ?? '';
        $this->supabaseKey = $_ENV['SUPABASE_ANON_KEY'] ?? '';
    }

    public function getSupabaseUrl(): string
    {
        return $this->supabaseUrl;
    }

    public function getSupabaseKey(): string
    {
        return $this->supabaseKey;
    }

    /**
     * Set user's access token from Supabase Auth (Google login).
     * When set, RLS policies evaluate auth.uid() as this user.
     */
    public function setAccessToken(?string $token): void
    {
        $this->accessToken = $token;
    }

    public function getAccessToken(): ?string
    {
        return $this->accessToken;
    }

    /**
     * Verify a Supabase Auth access token and return the user info.
     */
    public function getUser(string $accessToken): ?array
    {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $this->supabaseUrl . '/auth/v1/user');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'apikey: ' . $this->supabaseKey,
            'Authorization: Bearer ' . $accessToken,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || $response === false) {
            return null;
        }

        $user = json_decode($response, true);
        return $user['id'] ?? null ? $user : null;
    }

    /**
     * Make request to Supabase REST API
     */
    public function request(string $endpoint, string $method = 'GET', array $data = null): array
    {
        $url = $this->supabaseUrl . '/rest/v1/' . $endpoint;

        // Use the user's access token when available so RLS evaluates
        // auth.uid() as the logged-in user. Fall back to the anon key.
        $bearer = $this->accessToken ?? $this->supabaseKey;

        $headers = [
            'Content-Type: application/json',
            'apikey: ' . $this->supabaseKey,
            'Authorization: Bearer ' . $bearer,
            'Prefer: return=representation'
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // Disable SSL verification for development
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        } elseif ($method === 'PATCH') {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        } elseif ($method === 'DELETE') {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            return [
                'status' => 0,
                'data' => ['error' => $error]
            ];
        }

        curl_close($ch);

        return [
            'status' => $httpCode,
            'data' => json_decode($response, true) ?? []
        ];
    }
}
