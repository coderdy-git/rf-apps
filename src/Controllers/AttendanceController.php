<?php

namespace App\Controllers;

use App\Config\Database;
use App\Models\AttendanceModel;

class AttendanceController
{
    private AttendanceModel $attendanceModel;
    private Database $db;

    private ?string $userId = null;
    private bool $authAttempted = false;

    public function __construct()
    {
        $this->db = new Database();
        $this->attendanceModel = new AttendanceModel($this->db);
    }

    /**
     * Authenticate the request via Supabase Auth access token
     * (issued by Google login on the frontend).
     */
    private function authenticate(): bool
    {
        if ($this->authAttempted) {
            return $this->userId !== null;
        }
        $this->authAttempted = true;

        $token = $this->bearerToken();
        if (!$token) {
            return false;
        }

        $user = $this->db->getUser($token);
        if (!$user) {
            return false;
        }

        // Pass the token through so RLS evaluates auth.uid() as this user.
        $this->db->setAccessToken($token);
        $this->userId = $user['id'];

        return true;
    }

    /**
     * Extract bearer token from the Authorization header.
     */
    private function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';

        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        }

        if (stripos($header, 'Bearer ') === 0) {
            return substr($header, 7);
        }

        return null;
    }

    /**
     * Get current user ID, or null if unauthenticated.
     */
    private function getCurrentUserId(): ?string
    {
        $this->authenticate();
        return $this->userId;
    }

    /**
     * Handle check-in
     */
    public function checkIn(): array
    {
        $userId = $this->getCurrentUserId();

        if (!$userId) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        // Check if already has absent status today
        $todayStatus = $this->attendanceModel->getTodayStatus($userId);
        if ($todayStatus) {
            return ['success' => false, 'message' => 'Tidak bisa check in, hari ini tercatat: ' . $todayStatus['status_type']];
        }

        // Check if already checked in today
        $todayCheck = $this->attendanceModel->getTodayAttendance($userId);

        if ($todayCheck && $this->hasCheckIn($todayCheck)) {
            return ['success' => false, 'message' => 'Already checked in today'];
        }

        $result = $this->attendanceModel->createAttendance($userId, 'Check In');

        return $result;
    }

    /**
     * Handle check-out
     */
    public function checkOut(): array
    {
        $userId = $this->getCurrentUserId();

        if (!$userId) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        // Check if already checked in today
        $todayCheck = $this->attendanceModel->getTodayAttendance($userId);

        if (!$todayCheck || !$this->hasCheckIn($todayCheck)) {
            return ['success' => false, 'message' => 'You need to check in first'];
        }

        if ($this->hasCheckOut($todayCheck)) {
            return ['success' => false, 'message' => 'Already checked out today'];
        }

        $result = $this->attendanceModel->createAttendance($userId, 'Check Out');

        return $result;
    }

    /**
     * Submit attendance status (Sakit, Cuti, Izin)
     */
    public function submitStatus(): array
    {
        $userId = $this->getCurrentUserId();

        if (!$userId) {
            return ['success' => false, 'message' => 'User not authenticated'];
        }

        // Check if already checked in today
        $todayCheck = $this->attendanceModel->getTodayAttendance($userId);
        foreach ($todayCheck as $record) {
            if ($record['status'] === 'Check In') {
                return ['success' => false, 'message' => 'Tidak bisa submit status, kamu sudah check in hari ini'];
            }
        }

        // Read JSON body (frontend sends application/json)
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $statusType = $input['status_type'] ?? $_POST['status_type'] ?? '';
        $notes = $input['notes'] ?? $_POST['notes'] ?? '';

        if (empty($statusType)) {
            return ['success' => false, 'message' => 'Status type is required'];
        }

        $result = $this->attendanceModel->createAttendanceStatus($userId, $statusType, $notes);

        return $result;
    }

    /**
     * Get attendance history, grouped per day.
     * Menggabungkan record check in/out dan status tidak hadir.
     */
    public function getHistory(): array
    {
        $userId = $this->getCurrentUserId();

        if (!$userId) {
            return ['success' => false, 'message' => 'User not authenticated', 'data' => []];
        }

        $attendance = $this->attendanceModel->getAttendanceHistory($userId);
        $statuses = $this->attendanceModel->getStatusHistory($userId);

        // Kelompokkan check in/out per tanggal
        $byDate = [];
        foreach ($attendance as $record) {
            $date = substr($record['created_at'], 0, 10);
            $byDate[$date]['date'] = $date;
            $byDate[$date]['records'][] = [
                'status' => $record['status'],
                'time' => $record['created_at'],
            ];
        }

        // Gabungkan status tidak hadir (satu per tanggal)
        foreach ($statuses as $status) {
            $date = $status['date'];
            $byDate[$date]['date'] = $date;
            $byDate[$date]['absent'] = [
                'status_type' => $status['status_type'],
                'notes' => $status['notes'] ?? '',
            ];
        }

        // Urutkan terbaru di atas
        krsort($byDate);

        return [
            'success' => true,
            'data' => array_values($byDate)
        ];
    }

    /**
     * Get today's attendance record
     */
    public function getTodayStatus(): array
    {
        $userId = $this->getCurrentUserId();

        if (!$userId) {
            return ['success' => false, 'data' => null];
        }

        $attendance = $this->attendanceModel->getTodayAttendance($userId);
        $status = $this->attendanceModel->getTodayStatus($userId);

        return [
            'success' => true,
            'data' => [
                'attendance' => $attendance,
                'status' => $status
            ]
        ];
    }

    /**
     * Check if attendance has check-in
     */
    private function hasCheckIn(array $attendance): bool
    {
        foreach ($attendance as $record) {
            if ($record['status'] === 'Check In') {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if attendance has check-out
     */
    private function hasCheckOut(array $attendance): bool
    {
        foreach ($attendance as $record) {
            if ($record['status'] === 'Check Out') {
                return true;
            }
        }
        return false;
    }
}
