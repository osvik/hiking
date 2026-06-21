<?php

require_once __DIR__ . '/config.php';

function getDB(): PDO
{
    static $db = null;
    if ($db === null) {
        $db = new PDO('sqlite:' . DB_PATH);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('PRAGMA foreign_keys = ON');
        $db->exec('PRAGMA journal_mode = WAL');

        $db->exec("
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL
            )
        ");

        $db->exec("
            CREATE TABLE IF NOT EXISTS points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id INTEGER NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                label TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
            )
        ");
    }
    return $db;
}
