/**
 * Hiking Assistant — real-time GPS tracking map.
 *
 * Renders an interactive Leaflet map that follows the user's position
 * using the HTML5 Geolocation API's watchPosition. Provides custom
 * zoom controls and a center-on-user button.
 *
 * @module hiking-assistant
 */
(function() {
  /** @constant {[number, number]} Default map center (Madrid) before GPS lock. */
  const DEFAULT_COORDS = [40.4168, -3.7038];

  /** @constant {number} Initial zoom level on map load and first GPS lock. */
  const DEFAULT_ZOOM = 16;

  /** @constant {number} Maximum allowed zoom level. */
  const MAX_ZOOM = 18;

  /** @constant {number} Minimum allowed zoom level. */
  const MIN_ZOOM = 3;

  /** @type {L.Map} Leaflet map instance. */
  let map;

  /** @type {L.Marker} Current user position marker on the map. */
  let userMarker;

  /** @type {L.Circle} Accuracy circle drawn around the user marker. */
  let userCircle;

  /** @type {number|null} watchPosition handle used to stop tracking. */
  let trackingId;

  /** @type {number} Current zoom level, kept in sync with map.getZoom(). */
  let currentZoom = DEFAULT_ZOOM;

  /** @type {boolean} Whether the map is actively following the user. */
  let followingUser = true;

  const badgeEl = document.getElementById('locationBadge');
  const centerBtn = document.getElementById('centerBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  /**
   * Initialises the Leaflet map with OpenStreetMap tiles.
   *
   * Disables the default zoom control and minimised attribution.
   * Hooks into zoom events to keep `currentZoom` in sync and
   * `movestart` to detect manual panning (which stops follow mode).
   */
  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
    }).setView(DEFAULT_COORDS, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

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

        createUserMarker(lat, lng, acc);

        if (followingUser) {
          map.setView([lat, lng]);
        }

        badgeEl.textContent = '📍 ' + lat.toFixed(5) + ', ' + lng.toFixed(5)
          + ' (±' + Math.round(acc) + 'm)';
        badgeEl.className = 'location-badge';

        if (!map._initialPositionSet) {
          map._initialPositionSet = true;
          currentZoom = DEFAULT_ZOOM;
          map.setView([lat, lng], currentZoom);
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

  centerBtn.addEventListener('click', function() {
    if (!userMarker) return;

    var latlng = userMarker.getLatLng();
    followingUser = true;
    updateCenterButtonStyle();
    map.flyTo(latlng, currentZoom, { duration: 0.6 });
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

  initMap();
  startTracking();
})();
