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

    $controller = new \App\Controllers\AttendanceController();

    switch ($uri) {
        case '/api/checkin':
            if ($method === 'POST') {
                $result = $controller->checkIn();
                echo json_encode($result);
            }
            break;

        case '/api/checkout':
            if ($method === 'POST') {
                $result = $controller->checkOut();
                echo json_encode($result);
            }
            break;

        case '/api/status':
            if ($method === 'POST') {
                $result = $controller->submitStatus();
                echo json_encode($result);
            } elseif ($method === 'GET') {
                $result = $controller->getTodayStatus();
                echo json_encode($result);
            }
            break;

        case '/api/history':
            if ($method === 'GET') {
                $result = $controller->getHistory();
                echo json_encode($result);
            }
            break;

        case '/api/health':
            // Health check endpoint
            echo json_encode([
                'status' => 'ok',
                'timestamp' => date('Y-m-d H:i:s'),
                'php_version' => PHP_VERSION
            ]);
            break;

        default:
            http_response_code(404);
            echo json_encode(['error' => 'Not found']);
    }
    exit;
}

// Serve main page
require_once __DIR__ . '/index.html';
