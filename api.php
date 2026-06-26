<?php

require_once __DIR__ . '/db.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function jsonResponse($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function errorResponse(string $message, int $code = 400): void
{
    jsonResponse(['success' => false, 'error' => $message], $code);
}

$action = $_GET['action'] ?? null;
if (!$action) {
    errorResponse('Missing action parameter');
}

$writeActions = ['create_route', 'edit_route', 'delete_route', 'add_point', 'remove_point', 'edit_point_label'];
if (in_array($action, $writeActions, true)) {
    $apiKey = $_GET['api_key'] ?? '';
    if ($apiKey !== API_KEY) {
        errorResponse('Invalid or missing api_key', 401);
    }
}

$db = getDB();

switch ($action) {
    case 'create_route':
        $name  = trim($_GET['name'] ?? '');
        $color = trim($_GET['color'] ?? '');
        if ($name === '' || $color === '') {
            errorResponse('name and color are required');
        }
        $stmt = $db->prepare('INSERT INTO routes (name, color) VALUES (:name, :color)');
        $stmt->execute(['name' => $name, 'color' => $color]);
        $id = (int) $db->lastInsertId();
        jsonResponse(['success' => true, 'data' => ['id' => $id, 'name' => $name, 'color' => $color]]);

    case 'add_point':
        $routeId = $_GET['route_id'] ?? null;
        $lat     = $_GET['lat'] ?? null;
        $lon     = $_GET['lon'] ?? null;
        $label   = trim($_GET['label'] ?? '');

        if ($routeId === null || $lat === null || $lon === null) {
            errorResponse('route_id, lat, and lon are required');
        }

        if (!is_numeric($lat) || !is_numeric($lon)) {
            errorResponse('lat and lon must be numeric values');
        }

        $routeStmt = $db->prepare('SELECT id FROM routes WHERE id = :id');
        $routeStmt->execute(['id' => $routeId]);
        if (!$routeStmt->fetch()) {
            errorResponse('Route not found', 404);
        }

        $maxPos = $db->prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM points WHERE route_id = :route_id');

        $db->beginTransaction();
        $maxPos->execute(['route_id' => $routeId]);
        $position = (int) $maxPos->fetch(PDO::FETCH_ASSOC)['next_pos'];

        $stmt = $db->prepare('INSERT INTO points (route_id, lat, lon, label, position) VALUES (:route_id, :lat, :lon, :label, :position)');
        $stmt->execute([
            'route_id' => $routeId,
            'lat'      => (float) $lat,
            'lon'      => (float) $lon,
            'label'    => $label !== '' ? $label : null,
            'position' => $position,
        ]);
        $pointId = (int) $db->lastInsertId();
        $db->commit();
        jsonResponse(['success' => true, 'data' => ['id' => $pointId, 'route_id' => (int) $routeId, 'lat' => (float) $lat, 'lon' => (float) $lon, 'label' => $label !== '' ? $label : null, 'position' => $position]], 201);

    case 'remove_point':
        $pointId = $_GET['point_id'] ?? null;
        if ($pointId === null) {
            errorResponse('point_id is required');
        }
        $stmt = $db->prepare('SELECT id FROM points WHERE id = :id');
        $stmt->execute(['id' => $pointId]);
        $point = $stmt->fetch();
        if (!$point) {
            errorResponse('Point not found', 404);
        }
        $db->prepare('DELETE FROM points WHERE id = :id')->execute(['id' => $pointId]);
        jsonResponse(['success' => true, 'message' => 'Point deleted']);

    case 'edit_point_label':
        $pointId = $_GET['point_id'] ?? null;
        $label   = trim($_GET['label'] ?? '');

        if ($pointId === null) {
            errorResponse('point_id is required');
        }

        $stmt = $db->prepare('SELECT id FROM points WHERE id = :id');
        $stmt->execute(['id' => $pointId]);
        if (!$stmt->fetch()) {
            errorResponse('Point not found', 404);
        }

        $db->prepare('UPDATE points SET label = :label WHERE id = :id')
           ->execute(['label' => $label !== '' ? $label : null, 'id' => $pointId]);
        jsonResponse(['success' => true, 'message' => 'Label updated']);

    case 'get_routes':
        $routes = $db->query('SELECT id, name, color FROM routes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);

        $pointStmt = $db->prepare('SELECT id, lat, lon, label, position FROM points WHERE route_id = :route_id ORDER BY position ASC');
        foreach ($routes as &$route) {
            $pointStmt->execute(['route_id' => $route['id']]);
            $route['points'] = $pointStmt->fetchAll(PDO::FETCH_ASSOC);
            $route['id'] = (int) $route['id'];
            foreach ($route['points'] as &$p) {
                $p['id']       = (int) $p['id'];
                $p['lat']      = (float) $p['lat'];
                $p['lon']      = (float) $p['lon'];
                $p['position'] = (int) $p['position'];
            }
        }
        jsonResponse(['success' => true, 'data' => $routes]);

    case 'get_route':
        $routeId = $_GET['route_id'] ?? null;
        if ($routeId === null) {
            errorResponse('route_id is required');
        }
        $stmt = $db->prepare('SELECT id, name, color FROM routes WHERE id = :id');
        $stmt->execute(['id' => $routeId]);
        $route = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$route) {
            errorResponse('Route not found', 404);
        }

        $pointStmt = $db->prepare('SELECT id, lat, lon, label, position FROM points WHERE route_id = :route_id ORDER BY position ASC');
        $pointStmt->execute(['route_id' => $routeId]);
        $points = $pointStmt->fetchAll(PDO::FETCH_ASSOC);

        $route['id'] = (int) $route['id'];
        foreach ($points as &$p) {
            $p['id']       = (int) $p['id'];
            $p['lat']      = (float) $p['lat'];
            $p['lon']      = (float) $p['lon'];
            $p['position'] = (int) $p['position'];
        }
        $route['points'] = $points;
        jsonResponse(['success' => true, 'data' => $route]);

    case 'delete_route':
        $routeId = $_GET['route_id'] ?? null;
        if ($routeId === null) {
            errorResponse('route_id is required');
        }
        $stmt = $db->prepare('SELECT id FROM routes WHERE id = :id');
        $stmt->execute(['id' => $routeId]);
        if (!$stmt->fetch()) {
            errorResponse('Route not found', 404);
        }
        $db->prepare('DELETE FROM routes WHERE id = :id')->execute(['id' => $routeId]);
        jsonResponse(['success' => true, 'message' => 'Route and all its points deleted']);

    case 'edit_route':
        $routeId = $_GET['route_id'] ?? null;
        $name    = $_GET['name'] ?? null;
        $color   = $_GET['color'] ?? null;

        if ($routeId === null) {
            errorResponse('route_id is required');
        }
        if ($name === null && $color === null) {
            errorResponse('At least one of name or color is required');
        }

        $stmt = $db->prepare('SELECT id FROM routes WHERE id = :id');
        $stmt->execute(['id' => $routeId]);
        if (!$stmt->fetch()) {
            errorResponse('Route not found', 404);
        }

        $fields = [];
        $params = ['id' => $routeId];

        if ($name !== null) {
            $name = trim($name);
            if ($name === '') {
                errorResponse('name cannot be empty');
            }
            $fields[] = 'name = :name';
            $params['name'] = $name;
        }
        if ($color !== null) {
            $color = trim($color);
            if ($color === '') {
                errorResponse('color cannot be empty');
            }
            $fields[] = 'color = :color';
            $params['color'] = $color;
        }

        $sql = 'UPDATE routes SET ' . implode(', ', $fields) . ' WHERE id = :id';
        $db->prepare($sql)->execute($params);
        jsonResponse(['success' => true, 'message' => 'Route updated']);

    case 'share_location':
        $nickname = trim($_GET['nickname'] ?? '');
        $lat      = $_GET['lat'] ?? null;
        $lon      = $_GET['lon'] ?? null;

        if ($nickname === '' || mb_strlen($nickname) > 15) {
            errorResponse('nickname is required and must be 15 chars or fewer');
        }
        if ($lat === null || $lon === null || !is_numeric($lat) || !is_numeric($lon)) {
            errorResponse('lat and lon are required and must be numeric');
        }

        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        if (($ip === '' || $ip === '::1') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        }

        $now = time();

        $upsert = $db->prepare('
            INSERT INTO shared_locations (nickname, lat, lon, updated_at, ip)
            VALUES (:nickname, :lat, :lon, :time, :ip)
            ON CONFLICT(nickname) DO UPDATE SET
                lat = excluded.lat,
                lon = excluded.lon,
                updated_at = excluded.updated_at,
                ip = excluded.ip
        ');
        $upsert->execute([
            'nickname' => $nickname,
            'lat'      => (float) $lat,
            'lon'      => (float) $lon,
            'time'     => $now,
            'ip'       => $ip,
        ]);

        $cutoff = $now - SHARE_TIMEOUT_MINUTES * 60;
        $db->prepare('DELETE FROM shared_locations WHERE updated_at < :cutoff')
           ->execute(['cutoff' => $cutoff]);

        $rows = $db->query('SELECT nickname, lat, lon, updated_at FROM shared_locations')
                   ->fetchAll(PDO::FETCH_ASSOC);

        $users = array_map(function ($r) {
            return [
                'nickname'    => $r['nickname'],
                'lat'         => (float) $r['lat'],
                'lon'         => (float) $r['lon'],
                'updated_at'  => (int) $r['updated_at'],
            ];
        }, $rows);

        jsonResponse(['success' => true, 'data' => $users]);

    case 'stop_sharing':
        $nickname = trim($_GET['nickname'] ?? '');
        if ($nickname === '') {
            errorResponse('nickname is required');
        }
        $db->prepare('DELETE FROM shared_locations WHERE nickname = :nickname')
           ->execute(['nickname' => $nickname]);
        jsonResponse(['success' => true, 'message' => 'Stopped sharing']);

    default:
        errorResponse('Unknown action: ' . $action);
}
