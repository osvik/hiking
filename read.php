<?php

require_once __DIR__ . '/api_bootstrap.php';

$db = getDB();

switch ($action) {
    case 'get_routes':
        $routes = $db->query('SELECT id, name, color FROM routes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);

        $pointStmt = $db->prepare('SELECT id, lat, lon, label, position, altitude FROM points WHERE route_id = :route_id ORDER BY position ASC');
        foreach ($routes as &$route) {
            $pointStmt->execute(['route_id' => $route['id']]);
            $route['points'] = $pointStmt->fetchAll(PDO::FETCH_ASSOC);
            $route['id'] = (int) $route['id'];
            foreach ($route['points'] as &$p) {
                $p['id']       = (int) $p['id'];
                $p['lat']      = (float) $p['lat'];
                $p['lon']      = (float) $p['lon'];
                $p['position'] = (int) $p['position'];
                $p['altitude'] = $p['altitude'] !== null ? (float) $p['altitude'] : null;
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

        $pointStmt = $db->prepare('SELECT id, lat, lon, label, position, altitude FROM points WHERE route_id = :route_id ORDER BY position ASC');
        $pointStmt->execute(['route_id' => $routeId]);
        $points = $pointStmt->fetchAll(PDO::FETCH_ASSOC);

        $route['id'] = (int) $route['id'];
        foreach ($points as &$p) {
            $p['id']       = (int) $p['id'];
            $p['lat']      = (float) $p['lat'];
            $p['lon']      = (float) $p['lon'];
            $p['position'] = (int) $p['position'];
            $p['altitude'] = $p['altitude'] !== null ? (float) $p['altitude'] : null;
        }
        $route['points'] = $points;
        jsonResponse(['success' => true, 'data' => $route]);

    default:
        errorResponse('Unknown action: ' . $action);
}
