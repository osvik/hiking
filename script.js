(function() {
  const DEFAULT_COORDS = [40.4168, -3.7038];
  const DEFAULT_ZOOM = 16;
  const MAX_ZOOM = 18;
  const MIN_ZOOM = 3;

  let map;
  let userMarker;
  let userCircle;
  let trackingId;
  let currentZoom = DEFAULT_ZOOM;
  let followingUser = true;

  const badgeEl = document.getElementById('locationBadge');
  const centerBtn = document.getElementById('centerBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

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

  function moveToUser(lat, lng, animate) {
    followingUser = true;
    updateCenterButtonStyle();

    if (animate) {
      map.flyTo([lat, lng], currentZoom, { duration: 0.8 });
    } else {
      map.setView([lat, lng], currentZoom);
    }
  }

  function updateCenterButtonStyle() {
    if (followingUser) {
      centerBtn.style.background = '#007aff';
      centerBtn.querySelector('svg').style.fill = '#fff';
    } else {
      centerBtn.style.background = '#fff';
      centerBtn.querySelector('svg').style.fill = '#333';
    }
  }

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
