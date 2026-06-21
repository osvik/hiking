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

## Tech

- [Leaflet.js](https://leafletjs.com/) — interactive maps
- [OpenStreetMap](https://www.openstreetmap.org/) — tile imagery
- [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) — GPS access
