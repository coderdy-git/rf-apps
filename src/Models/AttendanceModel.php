<?php

namespace App\Models;

use App\Config\Database;

class AttendanceModel
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /**
     * Create attendance record (Check In / Check Out)
     */
    public function createAttendance(string $userId, string $status): array
    {
        $data = [
            'user_id' => $userId,
            'status' => $status,
            'created_at' => date('Y-m-d H:i:sP')
        ];

        $result = $this->db->request('attendances', 'POST', $data);

        if ($result['status'] === 201) {
            return ['success' => true, 'message' => "Successfully $status"];
        }

        return ['success' => false, 'message' => 'Failed to create attendance record', 'details' => $result['data']];
    }

    /**
     * Create attendance status (Sakit, Cuti, Izin, etc)
     */
    public function createAttendanceStatus(string $userId, string $statusType, string $notes = ''): array
    {
        $today = date('Y-m-d');

        // Check if already has status for today
        $existing = $this->getTodayStatus($userId);

        if (!empty($existing)) {
            return ['success' => false, 'message' => 'Already submitted status for today'];
        }

        $data = [
            'user_id' => $userId,
            'date' => $today,
            'status_type' => $statusType,
            'notes' => $notes,
            'created_at' => date('Y-m-d H:i:sP'),
            'updated_at' => date('Y-m-d H:i:sP')
        ];

        $result = $this->db->request('attendance_status', 'POST', $data);

        if ($result['status'] === 201) {
            return ['success' => true, 'message' => 'Status submitted successfully'];
        }

        return ['success' => false, 'message' => 'Failed to submit status'];
    }

    /**
     * Get today's attendance records
     */
    public function getTodayAttendance(string $userId): array
    {
        $today = date('Y-m-d');
        $endpoint = "attendances?user_id=eq.$userId&created_at=gte.$today&order=created_at.asc";

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Get today's attendance status
     */
    public function getTodayStatus(string $userId): ?array
    {
        $today = date('Y-m-d');
        $endpoint = "attendance_status?user_id=eq.$userId&date=eq.$today";

        $result = $this->db->request($endpoint);
        $data = $result['data'] ?? [];

        return !empty($data) ? $data[0] : null;
    }

    /**
     * Get attendance history for a user
     */
    public function getAttendanceHistory(string $userId, int $limit = 30): array
    {
        $endpoint = "attendances?user_id=eq.$userId&order=created_at.desc&limit=$limit";

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }

    /**
     * Get attendance status history for a user
     */
    public function getStatusHistory(string $userId, int $limit = 30): array
    {
        $endpoint = "attendance_status?user_id=eq.$userId&order=date.desc&limit=$limit";

        $result = $this->db->request($endpoint);

        return $result['data'] ?? [];
    }
}
