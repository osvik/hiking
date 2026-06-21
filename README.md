# Hiking Assistant

Real-time GPS tracking map for hiking. Built with Leaflet.js and the HTML5 Geolocation API.

## Features

- Real-time position tracking via `watchPosition()`
- Custom zoom controls (+/−)
- Center-on-user button with follow mode
- Mobile-first design

## Setup

1. Clone or copy the files into a web server directory.
2. Serve the files over **HTTPS** (or `http://localhost` for testing).  
   The Geolocation API is blocked by browsers on insecure origins.
3. Open `index.html`.

## Files

| File | Purpose |
|---|---|
| `index.html` | HTML structure |
| `style.css` | Styles and layout |
| `script.js` | Map logic and GPS tracking |
| `config.php` | SQLite database path configuration |
| `db.php` | Database connection and schema |
| `api.php` | REST API for routes and points |

## API

All endpoints return JSON. Base URL is `api.php`.

### Response format

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

### Actions

#### Create a route

```
GET api.php?action=create_route&name=MyRoute&color=#ff0000
```

| Param | Required | Description |
|---|---|---|
| `name` | Yes | Route name |
| `color` | Yes | Route color (hex, name, etc.) |

#### Edit a route

```
GET api.php?action=edit_route&route_id=1&name=NewName&color=#00ff00
```

| Param | Required | Description |
|---|---|---|
| `route_id` | Yes | Route ID |
| `name` | No | New name |
| `color` | No | New color |

At least one of `name` or `color` is required.

#### Delete a route

```
GET api.php?action=delete_route&route_id=1
```

Deletes the route and all its points.

#### Get all routes

```
GET api.php?action=get_routes
```

Returns all routes with their points nested.

#### Get a single route

```
GET api.php?action=get_route&route_id=1
```

Returns the route metadata and its points.

#### Add a point

```
GET api.php?action=add_point&route_id=1&lat=42.123&lon=-3.456&label=Summit
```

| Param | Required | Description |
|---|---|---|
| `route_id` | Yes | Route ID |
| `lat` | Yes | Latitude |
| `lon` | Yes | Longitude |
| `label` | No | Optional point label |

Points are appended at the end of the route (position is auto-incremented).

#### Edit a point label

```
GET api.php?action=edit_point_label&point_id=5&label=NewLabel
```

| Param | Required | Description |
|---|---|---|
| `point_id` | Yes | Point ID |
| `label` | No | New label (empty string clears it) |

#### Remove a point

```
GET api.php?action=remove_point&point_id=5
```

## Configuration

Edit `config.php` to change the SQLite database file location:

```php
define('DB_PATH', __DIR__ . '/hiking.db');
```

If the database file does not exist, it is created automatically on the first API call.

## Tech

- [Leaflet.js](https://leafletjs.com/) — interactive maps
- [OpenStreetMap](https://www.openstreetmap.org/) — tile imagery
- [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) — GPS access
- PHP + SQLite — backend API
