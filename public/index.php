<?php

/**
 * Cari folder induk yang berisi src/ dan vendor/.
 *
 * Di lokal, index.php ada di public/ sehingga induknya adalah satu level di atas.
 * Di cPanel, document root terkunci ke folder subdomain, jadi seluruh isi project
 * (termasuk public/) di-upload ke satu folder yang sama — induknya folder itu sendiri.
 *
 * Pencarian ini membuat file yang sama jalan di dua struktur tanpa diubah.
 */
$baseDir = null;
foreach ([__DIR__ . '/..', __DIR__] as $candidate) {
    if (is_dir($candidate . '/src') && is_dir($candidate . '/vendor')) {
        $baseDir = $candidate;
        break;
    }
}

if ($baseDir === null) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'Instalasi tidak lengkap: folder src/ dan vendor/ tidak ditemukan.'
    ]);
    exit;
}

// Load Composer autoloader — class App\* di-resolve otomatis lewat PSR-4
require_once $baseDir . '/vendor/autoload.php';

// Load environment variables
use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable($baseDir);
$dotenv->load();

// Start session
session_start();

// Simple routing
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// API Routes
if (strpos($uri, '/api/') === 0) {
    header('Content-Type: application/json');

    // Forward the Authorization header (PHP built-in server strips it otherwise)
    if (!isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $_SERVER['HTTP_AUTHORIZATION'] = $value;
                break;
            }
        }
    }

    // --- Absensi ---
    $attendance = new \App\Controllers\AttendanceController();

    switch ($uri) {
        case '/api/checkin':
            if ($method === 'POST') {
                echo json_encode($attendance->checkIn());
                exit;
            }
            break;

        case '/api/checkout':
            if ($method === 'POST') {
                echo json_encode($attendance->checkOut());
                exit;
            }
            break;

        case '/api/status':
            if ($method === 'POST') {
                echo json_encode($attendance->submitStatus());
                exit;
            }
            if ($method === 'GET') {
                echo json_encode($attendance->getTodayStatus());
                exit;
            }
            break;

        case '/api/history':
            if ($method === 'GET') {
                echo json_encode($attendance->getHistory());
                exit;
            }
            break;

        case '/api/health':
            echo json_encode([
                'status' => 'ok',
                'timestamp' => date('Y-m-d H:i:s'),
                'php_version' => PHP_VERSION,
            ]);
            exit;
    }

    // --- Buku Piutang ---
    $contacts = new \App\Controllers\ContactController();
    $receivables = new \App\Controllers\ReceivableController();
    $deposits = new \App\Controllers\DepositController();
    $payments = new \App\Controllers\PaymentController();

    $UUID = '[0-9a-fA-F-]{36}';

    // /api/contacts/{id}/payments/preview
    if (preg_match("#^/api/contacts/($UUID)/payments/preview$#", $uri, $m)) {
        if ($method === 'POST') { echo json_encode($payments->preview($m[1])); exit; }
    }

    // /api/contacts/{id}/payments
    if (preg_match("#^/api/contacts/($UUID)/payments$#", $uri, $m)) {
        if ($method === 'GET')  { echo json_encode($payments->index($m[1])); exit; }
        if ($method === 'POST') { echo json_encode($payments->store($m[1])); exit; }
    }

    // /api/payments/{id}
    if (preg_match("#^/api/payments/($UUID)$#", $uri, $m)) {
        if ($method === 'DELETE') { echo json_encode($payments->destroy($m[1])); exit; }
    }

    // /api/contacts/{id}/deposits
    if (preg_match("#^/api/contacts/($UUID)/deposits$#", $uri, $m)) {
        $contactId = $m[1];

        if ($method === 'GET')  { echo json_encode($deposits->index($contactId)); exit; }
        if ($method === 'POST') { echo json_encode($deposits->store($contactId)); exit; }
    }

    // /api/deposits/{id}
    if (preg_match("#^/api/deposits/($UUID)$#", $uri, $m)) {
        if ($method === 'DELETE') { echo json_encode($deposits->destroy($m[1])); exit; }
    }

    // /api/contacts  dan  /api/contacts/{id}
    if (preg_match("#^/api/contacts(?:/($UUID))?$#", $uri, $m)) {
        $id = $m[1] ?? null;

        if ($id === null) {
            if ($method === 'GET')  { echo json_encode($contacts->index()); exit; }
            if ($method === 'POST') { echo json_encode($contacts->store()); exit; }
        } else {
            if ($method === 'GET')    { echo json_encode($contacts->show($id)); exit; }
            if ($method === 'PATCH')  { echo json_encode($contacts->update($id)); exit; }
            if ($method === 'DELETE') { echo json_encode($contacts->destroy($id)); exit; }
        }
    }

    // /api/receivables  dan  /api/receivables/{id}
    if (preg_match('#^/api/receivables(?:/([0-9a-fA-F-]{36}))?$#', $uri, $m)) {
        $id = $m[1] ?? null;

        if ($id === null) {
            if ($method === 'POST') { echo json_encode($receivables->store()); exit; }
        } else {
            if ($method === 'PATCH')  { echo json_encode($receivables->update($id)); exit; }
            if ($method === 'DELETE') { echo json_encode($receivables->destroy($id)); exit; }
        }
    }

    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
    exit;
}

// Serve main page
require_once __DIR__ . '/index.html';
