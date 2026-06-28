/**
 * Hiking Assistant — real-time GPS tracking map.
 *
 * Renders an interactive Leaflet map that follows the user's position
 * using the HTML5 Geolocation API's watchPosition. Provides custom
 * zoom controls and a center-on-user button.
 *
 * @module map
 */
import { handleCreateRoute, handleFinishRoute, handleAddPoint, loadAllRoutes, restoreEditingRoute, getRouteParamsFromURL, showModal } from './routes.js';

/** @constant {[number, number]} Default map center (Madrid) before GPS lock. */
const DEFAULT_COORDS = [40.4168, -3.7038];

/** @constant {number} Initial zoom level on map load and first GPS lock. */
const DEFAULT_ZOOM = 16;

/** @constant {number} Maximum allowed zoom level. */
const MAX_ZOOM = 18;

/** @constant {number} Minimum allowed zoom level. */
const MIN_ZOOM = 4;

/** @type {L.Map} Leaflet map instance. */
let map;

/** @type {L.Marker} Current user position marker on the map. */
let userMarker;

/** @type {L.Circle} Accuracy circle drawn around the user marker. */
let userCircle;

/** @type {number|null} watchPosition handle used to stop tracking. */
let trackingId;

/** @type {number} Current zoom level, kept in sync with map.getZoom(). */
let currentZoom;

/** @type {boolean} Whether the map is actively following the user. */
let followingUser;

/** @type {boolean} Whether location sharing is currently active. */
let sharingEnabled = false;

/** @type {string|null} Nickname used for sharing, null when not sharing. */
let sharingNickname = null;

/** @type {number|null} setInterval handle for periodic share pings. */
let shareIntervalId = null;

/** @type {number|null} Timestamp (ms) of the first share in this session. */
let firstShareTime = null;

/** @type {L.LayerGroup} Layer group holding other users' shared-location markers. */
let sharedMarkersLayer = L.layerGroup();

/** @type {number} How many other users are currently sharing. */
let sharingCount = 0;

/**
 * Updates the sharing label to show the count of other sharing users
 * followed by the user's own nickname.
 */
function updateSharingLabel() {
  if (!sharingEnabled || !sharingNickname) return;
  sharingLabel.textContent = sharingCount + ' sharing · ' + sharingNickname;
}

const badgeEl = document.getElementById('locationBadge');

const centerBtn = document.getElementById('centerBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');
const menuMap = document.getElementById('menuMap');
const menuSatellite = document.getElementById('menuSatellite');
const menuCompass = document.getElementById('menuCompass');
const menuWeather = document.getElementById('menuWeather');
const menuCreateRoute = document.getElementById('menuCreateRoute');
const menuFinishRoute = document.getElementById('menuFinishRoute');
const menuList = document.getElementById('menuList');
const menuAdmin = document.getElementById('menuAdmin');
const menuShareLocation = document.getElementById('menuShareLocation');
const sharingLabel = document.getElementById('sharingLabel');

/**
 * Reads latitude, longitude and zoom from URL query parameters.
 *
 * @returns {{coords: [number,number], zoom: number}?} Parsed coordinates
 *   and zoom, or null if URL params are missing or invalid.
 */
function getMapParamsFromURL() {
  var params = new URLSearchParams(window.location.search);
  var lat = parseFloat(params.get('lat'));
  var lng = parseFloat(params.get('long'));
  var z = parseInt(params.get('z'), 10);
  if (isNaN(lat) || isNaN(lng)) return null;
  return {
    coords: [lat, lng],
    zoom: isNaN(z) ? DEFAULT_ZOOM : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)),
  };
}

/**
 * Updates the browser URL query parameters (lat, long, z) to match the
 * current map centre and zoom level without reloading the page.
 */
function updateUrlFromMap() {
  if (!map) return;
  var c = map.getCenter();
  var z = map.getZoom();
  var url = new URL(window.location);
  url.searchParams.set('lat', c.lat.toFixed(5));
  url.searchParams.set('long', c.lng.toFixed(5));
  url.searchParams.set('z', z);
  history.replaceState(null, '', url);
}

/** @type {{coords: [number,number], zoom: number}?} Map overrides from URL params. */
const urlMapParams = getMapParamsFromURL();

currentZoom = (urlMapParams || {}).zoom || DEFAULT_ZOOM;
followingUser = !urlMapParams;

/**
 * Initialises the Leaflet map with OpenStreetMap tiles.
 *
 * Disables the default zoom control and minimised attribution.
 * Hooks into zoom events to keep `currentZoom` in sync and
 * `movestart` to detect manual panning (which stops follow mode).
 */
function initMap() {
  var coords = urlMapParams ? urlMapParams.coords : DEFAULT_COORDS;
  var zoom = urlMapParams ? urlMapParams.zoom : DEFAULT_ZOOM;

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
  }).setView(coords, zoom);

  sharedMarkersLayer.addTo(map);

  if (window.TILE_LAYER === 'esri_satellite') {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }).addTo(map);
  } else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  L.control.attribution({
    prefix: false,
    position: 'bottomleft'
  }).addTo(map);

  map.on('zoom', function() {
    currentZoom = map.getZoom();
  });

  map.on('movestart', function() {
    followingUser = false;
    updateCenterButtonStyle();
  });

  map.on('moveend', function() {
    updateUrlFromMap();
  });

  map.on('zoomend', function() {
    updateUrlFromMap();
  });
}

/**
 * Places (or moves) the user position marker and accuracy circle.
 *
 * Removes any previous marker and circle before creating new ones
 * so the user sees a single, up-to-date dot on the map.
 *
 * @param {number} lat - Latitude from the GPS position.
 * @param {number} lng - Longitude from the GPS position.
 * @param {number} accuracy - GPS accuracy in metres (radius of the circle).
 */
function createUserMarker(lat, lng, accuracy) {
  var icon = L.divIcon({
    className: '',
    html: '<svg width="28" height="28" viewBox="0 0 24 24" style="transform:translate(-14px,-14px)">'
        + '<circle cx="12" cy="12" r="11" fill="#007aff" stroke="#fff" stroke-width="3" opacity="0.95"/>'
        + '<circle cx="12" cy="12" r="4" fill="#fff"/>'
        + '</svg>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  if (userMarker) {
    map.removeLayer(userMarker);
  }
  if (userCircle) {
    map.removeLayer(userCircle);
  }

  userMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 900 }).addTo(map);

  if (accuracy) {
    userCircle = L.circle([lat, lng], {
      radius: accuracy,
      weight: 1,
      color: '#007aff',
      fillColor: '#007aff',
      fillOpacity: 0.12,
    }).addTo(map);
  }
}

/**
 * Pans the map to the given coordinates and re-enables follow mode.
 *
 * @param {number} lat - Target latitude.
 * @param {number} lng - Target longitude.
 * @param {boolean} animate - Whether to fly (animated) or jump instantly.
 */
function moveToUser(lat, lng, animate) {
  followingUser = true;
  updateCenterButtonStyle();

  if (animate) {
    map.flyTo([lat, lng], currentZoom, { duration: 0.8 });
  } else {
    map.setView([lat, lng], currentZoom);
  }
}

/**
 * Toggles the centre button appearance to reflect follow state.
 *
 * Blue fill when following the user, white/grey when the user has
 * manually panned away.
 */
function updateCenterButtonStyle() {
  if (followingUser) {
    centerBtn.style.background = '#007aff';
    centerBtn.querySelector('svg').style.fill = '#fff';
  } else {
    centerBtn.style.background = '#fff';
    centerBtn.querySelector('svg').style.fill = '#333';
  }
}

/**
 * Starts watching the device GPS position via the Geolocation API.
 *
 * On each position update the marker is moved, the badge is refreshed,
 * and the map is recentred if follow mode is active. On the first
 * successful lock the map jumps to the user at DEFAULT_ZOOM.
 */
function startTracking() {
  if (!navigator.geolocation) {
    badgeEl.textContent = '❌ Geolocation not supported';
    badgeEl.className = 'location-badge error';
    return;
  }

  trackingId = navigator.geolocation.watchPosition(
    function(position) {
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      var acc = position.coords.accuracy;
      var alt = position.coords.altitude;

      createUserMarker(lat, lng, acc);

      if (followingUser) {
        map.setView([lat, lng]);
      }

      if (alt == null && !map._altWarned) {
        console.warn('Altitude not provided by browser/device — only lat/lon shown');
        map._altWarned = true;
      }

      badgeEl.textContent = '📍 ' + lat.toFixed(5) + ', ' + lng.toFixed(5)
        + (alt != null ? ', ' + Math.round(alt) : '')
        + ' (±' + Math.round(acc) + 'm)';
      badgeEl.className = 'location-badge';

      if (!map._initialPositionSet) {
        map._initialPositionSet = true;
        if (!urlMapParams) {
          currentZoom = DEFAULT_ZOOM;
          map.setView([lat, lng], currentZoom);
        }
      }
    },
    function(err) {
      var msg;
      switch(err.code) {
        case err.PERMISSION_DENIED: msg = '❌ Location denied'; break;
        case err.POSITION_UNAVAILABLE: msg = '❌ No position available'; break;
        case err.TIMEOUT: msg = '❌ Location timeout'; break;
        default: msg = '❌ Unknown error'; break;
      }
      badgeEl.textContent = msg;
      badgeEl.className = 'location-badge error';
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    }
  );
}

/**
 * Stops GPS tracking by clearing the watchPosition handle.
 */
function stopTracking() {
  if (trackingId != null) {
    navigator.geolocation.clearWatch(trackingId);
    trackingId = null;
  }
}

/**
 * Builds a URL for switching between map/satellite views while preserving
 * the current map centre and zoom level as query parameters.
 *
 * @param {string} base - The target page filename (e.g. "index.html").
 * @returns {string} The full URL with lat, long, and z query params.
 */
function buildViewUrl(base) {
  if (!map) return base;
  var c = map.getCenter();
  var z = map.getZoom();
  var url = new URL(base, window.location);
  url.searchParams.set('lat', c.lat.toFixed(5));
  url.searchParams.set('long', c.lng.toFixed(5));
  url.searchParams.set('z', z);
  return url.toString();
}

/**
 * Sends the user's current position to the share_location API endpoint
 * and re-renders all shared users on the map.
 *
 * Requires a GPS lock (userMarker). If there is no lock yet the tick
 * is skipped — the interval keeps retrying on later ticks. Shares are
 * sent via a direct fetch (NOT apiCall) so they are never queued
 * offline; a stale queued location would be useless. On network error
 * we log and continue silently.
 */
function sendShare() {
  if (!sharingEnabled || !sharingNickname) return;
  if (!userMarker) return;

  var latlng = userMarker.getLatLng();
  var url = 'api.php?action=share_location'
    + '&nickname=' + encodeURIComponent(sharingNickname)
    + '&lat=' + encodeURIComponent(latlng.lat)
    + '&lon=' + encodeURIComponent(latlng.lng);

  fetch(url).then(function(res) {
    return res.text().then(function(text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.log('share_location: non-JSON response, skipping tick');
        return null;
      }
      if (!data || !data.success) {
        console.log('share_location: ' + (data && data.error ? data.error : 'error'));
        return null;
      }
      return data;
    });
  }).then(function(data) {
    if (data) renderSharedUsers(data.data || []);
  }).catch(function(err) {
    console.log('share_location: network error, will retry next tick (' + err.message + ')');
  });
}

/**
 * Renders all shared users as person-icon markers with a nickname bubble.
 *
 * Clears the shared-markers layer first, then adds a marker for every
 * user except the current user (self is skipped to avoid overlapping
 * the blue GPS dot).
 *
 * @param {Array<{nickname:string,lat:number,lon:number,updated_at:number}>} users
 */
function renderSharedUsers(users) {
  sharedMarkersLayer.clearLayers();
  var count = users.length;
  users.forEach(function(u) {
    if (u.nickname === sharingNickname) return;
    var icon = L.divIcon({
      className: 'shared-user-marker',
      html: '<svg width="32" height="32" viewBox="0 0 24 24">'
          + '<circle cx="12" cy="8" r="4" fill="#ff3b30" stroke="#fff" stroke-width="1.5"/>'
          + '<path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="#ff3b30" stroke="#fff" stroke-width="1.5"/>'
          + '</svg>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    var marker = L.marker([u.lat, u.lon], { icon: icon }).addTo(sharedMarkersLayer);
    marker.bindTooltip(u.nickname, {
      permanent: true,
      direction: 'top',
      offset: [0, -14],
      className: 'shared-user-bubble'
    });
  });
  sharingCount = count;
  updateSharingLabel();
}

/**
 * Enables location sharing: prompts for a nickname, persists it,
 * shows the sharing label, and starts the periodic share pings.
 */
function startSharing() {
  menuDropdown.classList.remove('open');
  showModal({
    title: 'Share Location',
    fields: [
      { id: 'nickname', label: 'Nickname (max 15 chars)', type: 'text', required: true, placeholder: 'e.g. MountainFox' }
    ]
  }).then(function(vals) {
    var nick = vals.nickname;
    if (nick.length > 15) {
      alert('Nickname must be 15 characters or fewer.');
      return;
    }
    sharingNickname = nick;
    sharingEnabled = true;
    localStorage.setItem('sharing_nickname', nick);
    sharingLabel.textContent = 'Sharing · ' + nick;
    sharingLabel.style.display = 'block';
    menuShareLocation.textContent = 'Stop sharing';
    menuShareLocation.classList.add('sharing-on');
    firstShareTime = Date.now();
    sendShare();
    shareIntervalId = setInterval(sendShare, 30000);
  }).catch(function() {
    // cancelled — do nothing
  });
}

/**
 * Disables location sharing: stops the periodic pings, asks the server to
 * delete this user immediately, clears state, hides the label, and removes
 * all shared-user markers. The server call is fire-and-forget (no offline
 * queue); on network error the server's timeout prune still applies.
 */
function stopSharing() {
  menuDropdown.classList.remove('open');
  if (shareIntervalId != null) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
  if (sharingNickname) {
    var url = 'api.php?action=stop_sharing&nickname=' + encodeURIComponent(sharingNickname);
    fetch(url).catch(function(err) {
      console.log('stop_sharing: network error, server will prune after timeout (' + err.message + ')');
    });
  }
  sharingEnabled = false;
  sharingNickname = null;
  localStorage.removeItem('sharing_nickname');
  sharingLabel.style.display = 'none';
  menuShareLocation.textContent = 'Share location';
  menuShareLocation.classList.remove('sharing-on');
  if (sharedMarkersLayer) sharedMarkersLayer.clearLayers();
  firstShareTime = null;
}

/**
 * Handles the "Share location" menu click: starts or stops sharing.
 */
function handleShareLocation() {
  if (sharingEnabled) {
    stopSharing();
  } else {
    startSharing();
  }
}

/**
 * Resumes sharing from a previously stored nickname (e.g. after a page
 * reload or when switching between map/satellite views).
 */
function restoreSharing() {
  var saved = localStorage.getItem('sharing_nickname');
  if (!saved) return;
  sharingNickname = saved;
  sharingEnabled = true;
  sharingLabel.textContent = 'Sharing · ' + saved;
  sharingLabel.style.display = 'block';
  menuShareLocation.textContent = 'Stop sharing';
  menuShareLocation.classList.add('sharing-on');
  firstShareTime = Date.now();
  sendShare();
  shareIntervalId = setInterval(sendShare, 30000);
}

menuMap.addEventListener('click', function() {
  window.location = buildViewUrl('index.html');
});

if (menuSatellite) {
  menuSatellite.addEventListener('click', function() {
    window.location = buildViewUrl('satellite.html');
  });
}

menuCompass.addEventListener('click', function() {
  window.location = 'compass.html';
});

if (menuWeather) {
  menuWeather.addEventListener('click', function() {
    window.location = buildViewUrl('weather.html');
  });
}

menuShareLocation.addEventListener('click', handleShareLocation);

menuCreateRoute.addEventListener('click', function() {
  menuDropdown.classList.remove('open');
  handleCreateRoute();
});

menuFinishRoute.addEventListener('click', function() {
  menuDropdown.classList.remove('open');
  handleFinishRoute();
});

menuList.addEventListener('click', function() {
  window.location = 'list.html';
});

menuAdmin.addEventListener('click', function() {
  window.location = 'admin.html';
});

centerBtn.addEventListener('click', function() {
  if (!userMarker) return;

  var latlng = userMarker.getLatLng();
  followingUser = true;
  updateCenterButtonStyle();
  map.flyTo(latlng, currentZoom, { duration: 0.6 });

  var url = new URL(window.location);
  url.searchParams.set('lat', latlng.lat.toFixed(5));
  url.searchParams.set('long', latlng.lng.toFixed(5));
  url.searchParams.set('z', currentZoom);
  history.replaceState(null, '', url.toString());
});

zoomInBtn.addEventListener('click', function() {
  if (currentZoom < MAX_ZOOM) {
    currentZoom++;
    map.setZoom(currentZoom);
  }
});

zoomOutBtn.addEventListener('click', function() {
  if (currentZoom > MIN_ZOOM) {
    currentZoom--;
    map.setZoom(currentZoom);
  }
});

menuBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  menuDropdown.classList.toggle('open');
});

document.addEventListener('click', function() {
  menuDropdown.classList.remove('open');
});

menuDropdown.addEventListener('click', function(e) {
  e.stopPropagation();
});

initMap();
startTracking();
restoreEditingRoute();
loadAllRoutes(getRouteParamsFromURL());
restoreSharing();

OfflineQueue.processQueue();

if (new URLSearchParams(window.location.search).get('action') === 'new') {
  handleCreateRoute();
}

export { map, userMarker };
