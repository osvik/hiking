<?php

$configPath = __DIR__ . '/config.php';

if (file_exists($configPath)) {
    header('Content-Type: text/html; charset=utf-8');
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hiking Assistant - Installed</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;color:#333;line-height:1.6}
.container{max-width:640px;margin:40px auto;padding:24px}
.card{background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:24px;margin-bottom:8px}
h2{font-size:18px;margin-bottom:16px;color:#2e7d32}
p{margin-bottom:12px}
code{background:#eee;padding:2px 6px;border-radius:3px;font-size:14px}
.note{padding:12px;background:#fff3e0;border-left:4px solid #ff9800;border-radius:4px}
</style>
</head>
<body>
<div class="container">
<div class="card">
<h1>Hiking Assistant</h1>
<h2>Already installed</h2>
<p><code>config.php</code> already exists — the application is installed.</p>
<div class="note">
<strong>Important:</strong> delete <code>install.php</code> if it is still on the server, to prevent anyone from re-running the installer.
</div>
</div>
</div>
</body>
</html>
    <?php
    exit;
}

$phpMinVersion = '7.4.0';

$requirements = [];

$requirements[] = [
    'label'    => 'PHP version &ge; ' . $phpMinVersion,
    'ok'       => version_compare(PHP_VERSION, $phpMinVersion, '>='),
    'detail'   => PHP_VERSION,
    'blocking' => true,
];

$requirements[] = [
    'label'    => 'PDO extension',
    'ok'       => extension_loaded('pdo'),
    'detail'   => extension_loaded('pdo') ? 'Loaded' : 'Missing',
    'blocking' => true,
];

$requirements[] = [
    'label'    => 'PDO SQLite extension',
    'ok'       => extension_loaded('pdo_sqlite'),
    'detail'   => extension_loaded('pdo_sqlite') ? 'Loaded' : 'Missing',
    'blocking' => true,
];

$requirements[] = [
    'label'    => 'JSON extension',
    'ok'       => extension_loaded('json'),
    'detail'   => extension_loaded('json') ? 'Loaded' : 'Missing',
    'blocking' => true,
];

$requirements[] = [
    'label'    => 'Directory writable',
    'ok'       => is_writable(__DIR__),
    'detail'   => is_writable(__DIR__) ? 'Writable' : 'Not writable — cannot create config.php',
    'blocking' => true,
];

try {
    $tmpDbPath = sys_get_temp_dir() . '/hiking_installer_' . bin2hex(random_bytes(4)) . '.db';
    $testDb = new PDO('sqlite:' . $tmpDbPath);
    $testDb->exec('CREATE TABLE _test (id INTEGER)');
    $testDb->exec('DROP TABLE _test');
    $testDb = null;
    unlink($tmpDbPath);
    $requirements[] = [
        'label'    => 'SQLite functional',
        'ok'       => true,
        'detail'   => 'Working',
        'blocking' => true,
    ];
} catch (Exception $e) {
    $requirements[] = [
        'label'    => 'SQLite functional',
        'ok'       => false,
        'detail'   => $e->getMessage(),
        'blocking' => true,
    ];
}

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['SERVER_PORT'] ?? null) == 443
        || ($_SERVER['REQUEST_SCHEME'] ?? '') === 'https'
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';

$isLocalhost = in_array($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '', ['localhost', '127.0.0.1', '::1'], true)
            || in_array($_SERVER['SERVER_NAME'] ?? '', ['localhost', '127.0.0.1', '::1'], true);

$isSecureContext = $isHttps || $isLocalhost;

$requirements[] = [
    'label'    => 'Secure context (Geolocation API)',
    'ok'       => $isSecureContext,
    'detail'   => $isSecureContext
                    ? ($isHttps ? 'HTTPS detected' : 'localhost — allowed for testing')
                    : 'HTTPS not detected and host is not localhost — the Geolocation API will be blocked by browsers',
    'blocking' => false,
];

$allOk = true;
foreach ($requirements as $r) {
    if (!$r['ok'] && $r['blocking']) {
        $allOk = false;
        break;
    }
}

$message     = '';
$messageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $allOk) {
    $apiKey = trim($_POST['api_key'] ?? '');
    if ($apiKey === '') {
        $apiKey = bin2hex(random_bytes(16));
    }

    $shareTimeout = (int) ($_POST['share_timeout'] ?? 10);
    if ($shareTimeout < 1) {
        $shareTimeout = 10;
    }

    $dbPath = trim($_POST['db_path'] ?? '');
    if ($dbPath === '') {
        $dbPath = __DIR__ . '/hiking.db';
    }

    $config  = "<?php\n\n";
    $config .= "define('DB_PATH', " . var_export($dbPath, true) . ");\n";
    $config .= "define('API_KEY', " . var_export($apiKey, true) . ");\n";
    $config .= "define('SHARE_TIMEOUT_MINUTES', " . $shareTimeout . ");\n";

    if (file_put_contents($configPath, $config) !== false) {
        chmod($configPath, 0640);
        $configWritten = true;
    } else {
        $message     = 'Failed to write config.php. Check file permissions.';
        $messageType = 'error';
    }
}

$suggestedApiKey       = bin2hex(random_bytes(16));
$suggestedDbPath       = __DIR__ . '/hiking.db';
$suggestedShareTimeout = 10;

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hiking Assistant - Installer</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;color:#333;line-height:1.6}
.container{max-width:640px;margin:40px auto;padding:24px}
.card{background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:16px}
h1{font-size:24px;margin-bottom:8px}
h2{font-size:18px;margin-bottom:16px}
p{margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
th{font-weight:600;width:180px}
 .pass{color:#2e7d32;font-weight:600}
 .fail{color:#c62828;font-weight:600}
 .warn{color:#e65100;font-weight:600}
label{display:block;margin-bottom:4px;font-weight:600}
input[type="text"],
input[type="number"]{width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;margin-bottom:16px}
input:focus{outline:none;border-color:#1b5e20;box-shadow:0 0 0 2px rgba(27,94,32,.2)}
button{padding:10px 24px;background:#1b5e20;color:#fff;border:none;border-radius:4px;font-size:15px;cursor:pointer}
button:hover{background:#2e7d32}
button:disabled{background:#9e9e9e;cursor:not-allowed}
.success{padding:12px;background:#e8f5e9;color:#2e7d32;border-left:4px solid #2e7d32;border-radius:4px;margin-bottom:16px}
.error{background:#ffebee;color:#c62828;border-left:4px solid #c62828}
.note{padding:12px;background:#fff3e0;border-left:4px solid #ff9800;border-radius:4px;margin-top:16px}
.form-group{margin-bottom:8px}
.detail{font-size:13px;color:#666}
</style>
</head>
<body>
<div class="container">
<div class="card">
<h1>Hiking Assistant</h1>
<h2>System Requirements</h2>
<table>
<?php foreach ($requirements as $r): ?>
<tr>
<td><?= $r['label'] ?></td>
<td class="<?= $r['ok'] ? 'pass' : (empty($r['blocking']) ? 'warn' : 'fail') ?>">
<?= $r['ok'] ? 'OK' : (empty($r['blocking']) ? 'WARN' : 'FAIL') ?>
</td>
</tr>
<?php if (!$r['ok']): ?>
<tr><td colspan="2" class="detail"><?= htmlspecialchars($r['detail']) ?></td></tr>
<?php endif; ?>
<?php endforeach; ?>
</table>
</div>

<?php if (isset($configWritten)): ?>
<div class="card">
<h2>Installation complete</h2>
<p><code>config.php</code> has been created successfully.</p>
<p><strong>Your API key:</strong> <code><?= htmlspecialchars($apiKey) ?></code></p>
<div class="note">
<strong>Important:</strong> delete <code>install.php</code> now to prevent anyone from overwriting your configuration.
</div>
</div>
<?php elseif (!$allOk): ?>
<div class="card">
<h2>Requirements not met</h2>
<p>Please fix the issues above before continuing.</p>
</div>
<?php else: ?>
<div class="card">
<h2>Configuration</h2>

<?php if ($message !== ''): ?>
<div class="<?= $messageType === 'error' ? 'success error' : 'success' ?>"><?= htmlspecialchars($message) ?></div>
<?php endif; ?>

<form method="post">
<div class="form-group">
<label for="db_path">Database path</label>
<input type="text" id="db_path" name="db_path" value="<?= htmlspecialchars($suggestedDbPath) ?>">
</div>

<div class="form-group">
<label for="api_key">API key</label>
<input type="text" id="api_key" name="api_key" value="<?= htmlspecialchars($suggestedApiKey) ?>" placeholder="Leave empty to auto-generate">
<p class="detail">Used to protect write operations (create/edit/delete routes).</p>
</div>

<div class="form-group">
<label for="share_timeout">Share timeout (minutes)</label>
<input type="number" id="share_timeout" name="share_timeout" value="<?= $suggestedShareTimeout ?>" min="1">
<p class="detail">How long shared locations remain visible.</p>
</div>

<button type="submit">Install</button>
</form>
</div>
<?php endif; ?>
</div>
</body>
</html>
