# Hiking Assistant

Real-time GPS tracking map and compass for hiking. Built with Leaflet.js, the HTML5 Geolocation API, and the DeviceOrientation API.

## Features

- Real-time position tracking via `watchPosition()`
- Compass using the device magnetometer (`DeviceOrientation` API)
- Navigation menu to switch between map and compass
- Custom zoom controls (+/−)
- Center-on-user button with follow mode
- Create hiking routes by adding GPS points on the map
- Routes persist in SQLite and reload on page load
- Filter displayed routes via `?route=` URL parameters
- Position map via `?lat=`, `?long=`, and `?z=` URL parameters
- Admin page to view, edit, and delete routes
- Mobile-first design

## Setup

1. Clone or copy the files into a web server directory.
2. Serve the files over **HTTPS** (or `http://localhost` for testing).  
   The Geolocation API is blocked by browsers on insecure origins.
3. Open `index.html`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Map page |
| `compass.html` | Compass page |
| `admin.html` | Admin page — manage routes |
| `style.css` | Shared styles and layout |
| `script.js` | Map logic and GPS tracking |
| `config.php` | SQLite database path configuration |
| `db.php` | Database connection and schema |
| `api.php` | REST API for routes and points |

## API

All endpoints return JSON. Base URL is `api.php`.

### Authentication

Write actions (`create_route`, `edit_route`, `delete_route`, `add_point`, `remove_point`, `edit_point_label`) require an API key:

```
GET api.php?action=create_route&name=X&color=red&api_key=YOUR_KEY
```

Read actions (`get_routes`, `get_route`) are public and don't require a key.

Set your API key in `config.php`:
```php
define('API_KEY', 'your-secret-key-here');
```

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

## Filtering Routes by URL

You can limit which routes appear on the map by passing repeated `?route=` query parameters containing route IDs.  For example:

```
index.html?route=1&route=2
```

This shows only routes 1 and 2 on the map.  Routes whose IDs are not listed are hidden.

- No `?route=` params → all routes are shown (default behaviour).
- `?route=1&route=2` → only routes 1 and 2 are rendered.
- Entering the "Create route" or "Finish route" flow automatically strips any `route` params from the URL, restoring the default "show all" behaviour.

## Positioning the Map by URL

You can set the initial map center and zoom level with `?lat=`, `?long=`, and `?z=` query parameters:

```
index.html?lat=42.123&long=-3.456&z=14
```

| Param | Required | Description |
|---|---|---|
| `lat` | Yes | Latitude (decimal degrees) |
| `long` | Yes | Longitude (decimal degrees) |
| `z` | No | Zoom level (4–18, defaults to 16) |

When these parameters are present, the map opens at the given coordinates and stays there — it does **not** automatically follow the user's GPS position.  The user's blue position marker still appears, and clicking the "center on me" button manually re-enables follow mode.

Without these parameters, the map starts centered on Madrid and jumps to the user's GPS position on the first location lock (default behaviour).

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
- [DeviceOrientation API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent) — compass heading
- PHP + SQLite — backend API
