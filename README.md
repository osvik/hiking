# Hiking Assistant

Real-time GPS tracking map and compass for hiking. Built with Leaflet.js, the HTML5 Geolocation API, and the DeviceOrientation API.

## Features

- Real-time position tracking via `watchPosition()` including altitude when available from GPS
- Compass using the device magnetometer (`DeviceOrientation` API), plus a live location badge (lat, lon, altitude)
- Navigation menu to switch between map, satellite, compass, and weather
- Hourly weather forecast (temperature, rain, snow, wind, sunrise/sunset) for the next 24 hours via [Open-Meteo](https://open-meteo.com/), shown in the device's timezone
- Custom zoom controls (+/−)
- Center-on-user button with follow mode
- Create hiking routes by adding GPS points on the map
- **Offline support** — route creation and point recording work without a connection and sync automatically when back online
- Routes persist in SQLite and reload on page load
- Filter displayed routes via `?route=` URL parameters
- Position map via `?lat=`, `?long=`, and `?z=` URL parameters
- Admin page to view, edit, and delete routes
- **Location sharing** — share your position with other hikers and see everyone else who is sharing on the map (gated: you must share your own to see others)
- Mobile-first design

## Setup

1. Clone or copy the files into a web server directory.
2. Open `install.php` in your browser (e.g. `https://example.com/install.php`).
   - The installer checks PHP version, required extensions (PDO, SQLite), and file permissions.
   - Fill in the configuration form (database path, API key, share timeout) and click **Install**.
   - The installer creates `config.php` with restrictive permissions (`0640`).
3. After installation, open `index.html`.
4. **Delete `install.php`** from the server when you're done, to prevent anyone from re-running it.
5. Serve the files over **HTTPS** (or `http://localhost` for testing).  
   The Geolocation API is blocked by browsers on insecure origins.

## Files

| File | Purpose |
|---|---|
| `index.html` | Map page |
| `satellite.html` | Satellite view (ESRI World Imagery) |
| `compass.html` | Compass page (heading + live location badge with altitude) |
| `weather.html` | Hourly weather forecast page (next 24h: temperature, rain, snow, wind, sunrise/sunset) |
| `admin.html` | Admin page — manage routes |
| `style.css` | Shared styles for the map pages (`index.html`, `satellite.html`) |
| `map.js` | Map core, GPS tracking (lat/lon/altitude), location sharing with real-time user count, URL parameter sync, and navigation |
| `routes.js` | Route editing, API communication, and modal dialogs |
| `offlineQueue.js` | Offline action queue — caches API calls in localStorage |
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
define('API_KEY', 'change-me-to-a-random-secret');
```

The client apps obtain the key from the user via a modal prompt on the first
write action and persist it in the browser's `localStorage` under the key
`api_key` (`routes.js`, `admin.html`). If a stored key is rejected by the
server (e.g. it was rotated in `config.php`), the prompt reappears
automatically. To force a re-prompt, clear the `api_key` entry from the
browser's localStorage.

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

Points are appended at the end of the route — `position` is computed as
`MAX(position) + 1` for the route at insert time.

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

#### Share location

```
GET api.php?action=share_location&nickname=MountainFox&lat=42.123&lon=-3.456
```

A **public** endpoint — no `api_key` required. Sharing is gated by "you must
share your own location to see others", not by a key.

Records (or updates) the caller's last known location and returns the last
known location of **all** known users. In the process it deletes every user
that was not updated within the last `SHARE_TIMEOUT_MINUTES` minutes
(default 10). This stale-prune covers hikers who went offline or closed the
page. A hiker who **deliberately** stops sharing is removed immediately via
the `stop_sharing` endpoint (see below).

| Param | Required | Description |
|---|---|---|
| `nickname` | Yes | Unique identifier, 1–15 chars (trimmed) |
| `lat` | Yes | Latitude (numeric) |
| `lon` | Yes | Longitude (numeric) |

The caller's IP is captured for audit only (`REMOTE_ADDR`, falling back to
the first `X-Forwarded-For` value) and is **never** returned in the response.

Response shape:

```json
{
  "success": true,
  "data": [
    { "nickname": "MountainFox", "lat": 42.123, "lon": -3.456, "updated_at": 1700000000 }
  ]
}
```

The caller's own entry is included in the response; the UI skips rendering
self to avoid overlapping the blue GPS dot. Nickname collisions resolve to
**last writer wins** (upsert).

#### Stop sharing

```
GET api.php?action=stop_sharing&nickname=MountainFox
```

A **public** endpoint — no `api_key` required. Immediately deletes the
caller's entry from `shared_locations` so other hikers stop seeing them
right away (rather than waiting for the `SHARE_TIMEOUT_MINUTES` prune,
which is meant for offline users, not deliberate stops).

| Param | Required | Description |
|---|---|---|
| `nickname` | Yes | The nickname to remove (trimmed) |

## Offline Caching

When the network is unavailable, route creation and point recording continue to work seamlessly.  Failed API calls are automatically queued in the browser's `localStorage` and replayed in order when connectivity returns.

### How it works

1. **API call fails (network error)** → the action is appended to an offline queue in `localStorage` (key `offline_queue`).
2. **The UI updates immediately** with optimistic data — the route and points appear on the map regardless of connectivity.
3. **When the browser comes back online** (or on the next page load), the queue is processed in strict FIFO order:
   - Each item is sent to the server one at a time.
   - The next item is never sent until the current one is confirmed.
   - An item is only removed from `localStorage` after the server acknowledges success.
4. **"Finish this route" events are also cached** so that all points are synced before the route is considered complete.

### Queue item types

| Action | Enqueued when | Effect during processing |
|---|---|---|
| `create_route` | Creating a route while offline | Creates the route on the server; maps the temp ID to the real server ID for subsequent items |
| `add_point` | Adding a point while offline | Sends the point to the correct route on the server |
| `finish_route` | Finishing a route while offline or with pending items | Client-side only; acts as a marker that all preceding items are synced |

### Temp ID mapping

Routes created offline are assigned a temporary client-generated ID (`temp_<timestamp>_<random>`).  Points recorded while offline reference this temp ID.  When the queued `create_route` is successfully processed by the server, the mapping `temp → real` is stored, and all subsequent queue items have their `route_id` updated to the real server ID before being sent.

### Resilience

- Items are **never dequeued until the server confirms success** — if a network error occurs mid-sync, the queue pauses and retries on the next `online` event.
- Non-network errors (4xx/5xx) are logged and the item is dequeued to prevent permanently blocking the queue.
- The queue is flushed on every page load, so closing the browser mid-sync does not lose data.

### localStorage keys

| Key | Content |
|---|---|
| `offline_queue` | JSON array of pending action items |
| `offline_id_map` | JSON object mapping temp route IDs to real server IDs |
| `api_key` | API key entered by the user (shared by map, route editing, and admin pages) |
| `editing_route` | JSON snapshot of the route currently being edited, so the in-progress route survives page reloads |
| `sharing_nickname` | Current sharing nickname; removed when sharing is turned off (see [Location Sharing](#location-sharing)) |

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

The map keeps `?lat=`, `?long=`, and `?z=` query parameters in the URL at all times, reflecting the current map center and zoom level.  They update whenever you pan or zoom the map, and when you click the "center on me" button they update to your GPS position.

```
index.html?lat=42.123&long=-3.456&z=14
```

| Param | Required | Description |
|---|---|---|
| `lat` | Yes | Latitude (decimal degrees) |
| `long` | Yes | Longitude (decimal degrees) |
| `z` | No | Zoom level (4–18, defaults to 16) |

You can share or bookmark the URL at any time to return to the exact same view.  When loading the map with these parameters, it opens at the given coordinates and does **not** automatically follow the user's GPS position.  The user's blue position marker still appears, and clicking the "center on me" button re-enables follow mode (and updates the URL params to your current location).

Without these parameters, the map starts centered on Madrid and jumps to the user's GPS position on the first location lock (default behaviour).

## Weather

`weather.html` shows an hourly forecast for the next 24 hours at a given
location, using the free [Open-Meteo](https://open-meteo.com/) API (no API
key, fetched directly from the browser — no backend required).

```
weather.html?lat=42.123&long=-3.456
```

| Param | Required | Description |
|---|---|---|
| `lat` | No* | Latitude (decimal degrees) |
| `long` | No* | Longitude (decimal degrees) |

\* If `lat`/`long` are omitted, the page falls back to the device's GPS via
the Geolocation API. The "Weather" menu entry on the map/satellite pages
passes the current map centre automatically.

The following are displayed when available from Open-Meteo:

- Predicted temperature by hour (°C)
- Predicted rain by hour (mm)
- Predicted snow by hour (cm)
- Predicted (average) wind speed by hour (km/h)
- Today's sunrise and sunset

All times are rendered in the **device's timezone**
(`Intl.DateTimeFormat().resolvedOptions().timeZone`); if that cannot be
determined, Open-Meteo's `auto` timezone (the queried location's local time)
is used. Metrics not returned by the API are hidden, and a fetch failure
shows an error badge instead of stale or empty data.

## Triggering Route Creation by URL

Pass `?action=new` to open the map page and immediately start the
create-route flow:

```
index.html?action=new
```

This is the link used by the **+** button on the admin page
(`admin.html`). On load, `map.js` detects the parameter and invokes
`handleCreateRoute()` automatically. Entering the flow also strips any
existing `?route=` params (see [Filtering Routes by URL](#filtering-routes-by-url)) and sets `?action=new` in the URL while the create modal is open, so the flow resumes correctly after a reload. The param is removed once the route is created or the modal is cancelled.

## Configuration

The installer creates `config.php` with the values you entered. To change
them later, edit `config.php` directly:

```php
define('DB_PATH', __DIR__ . '/hiking.db');
define('API_KEY', 'your-random-secret');
define('SHARE_TIMEOUT_MINUTES', 10);
```

If the database file does not exist, it is created automatically on the first API call.

The shared-location pruning timeout is in minutes; users not updated within
this window are deleted on each `share_location` call.

## Location Sharing

Hikers can share their live location with others from the map's hamburger menu.
The "Share location" toggle appears on both `index.html` and `satellite.html`
(the logic lives in `map.js`).

- **Off by default.** Toggling it on prompts for a nickname (1–15 chars), which
  is stored in `localStorage` under `sharing_nickname`.
- **Share-to-see**: you must share your own location to see who else is sharing.
- While sharing, a small red "&lt;count&gt; sharing · &lt;nickname&gt;" label appears below the
  location badge in the top-left, showing how many people are currently sharing
  (updated every 30 seconds with each share ping).
- Your location is sent to the server immediately on enable, then every 30
  seconds. Because the interval is anchored to each hiker's own first-share
  moment, requests are naturally staggered rather than firing globally at 0/30.
- Other hikers appear as a person icon with a nickname bubble above them. Your
  own marker is not duplicated.
- Toggling sharing off clears the nickname from `localStorage`, hides the label,
  and removes the other-user markers. It also fires a `stop_sharing` call so the
  server drops the user immediately — others don't see them for the remaining
  timeout window. The `SHARE_TIMEOUT_MINUTES` prune only catches hikers who went
  offline or closed the page without stopping (it's a safety net, not the stop
  path).
- Reloads and switching between Map ↔ Satellite preserve the sharing state via
  the stored nickname.

## Tech

- [Leaflet.js](https://leafletjs.com/) — interactive maps
- [OpenStreetMap](https://www.openstreetmap.org/) — map tile imagery
- [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) — satellite tile imagery
- [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) — GPS access
- [DeviceOrientation API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent) — compass heading
- [Open-Meteo](https://open-meteo.com/) — free weather forecast API
- [localStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) — offline queue and state persistence
- PHP + SQLite — backend API
