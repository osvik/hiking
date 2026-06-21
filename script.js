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
  let currentZoom = DEFAULT_ZOOM;

  /** @type {boolean} Whether the map is actively following the user. */
  let followingUser = true;

  const badgeEl = document.getElementById('locationBadge');
  const centerBtn = document.getElementById('centerBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const menuBtn = document.getElementById('menuBtn');
  const menuDropdown = document.getElementById('menuDropdown');

  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalCancel = document.getElementById('modalCancel');
  const modalSubmit = document.getElementById('modalSubmit');
  const addPointBtn = document.getElementById('addPointBtn');
  const menuMap = document.getElementById('menuMap');
  const menuCompass = document.getElementById('menuCompass');
  const menuCreateRoute = document.getElementById('menuCreateRoute');
  const menuFinishRoute = document.getElementById('menuFinishRoute');

  let modalResolve = null;
  let modalReject = null;

  let currentEditingRoute = null;
  let routePolyline = null;
  let routeMarkers = [];

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

  function getApiKey() {
    return localStorage.getItem('api_key') || null;
  }

  function setApiKey(key) {
    localStorage.setItem('api_key', key);
  }

  function promptForApiKey() {
    return showModal({
      title: 'API Key Required',
      fields: [{ id: 'api_key', label: 'Enter your API key', type: 'text', required: true }]
    }).then(function(vals) {
      setApiKey(vals.api_key);
      return vals.api_key;
    });
  }

  function apiCall(action, params) {
    var url = 'api.php?action=' + encodeURIComponent(action);
    Object.keys(params).forEach(function(k) {
      if (params[k] !== null && params[k] !== undefined) {
        url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }
    });
    return fetch(url).then(function(res) {
      return res.text().then(function(text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('Server returned non-JSON response (HTTP ' + res.status + '). Check that PHP is running and sqlite extension is enabled. Raw start: ' + text.substring(0, 200));
        }
        if (!data.success) {
          throw new Error(data.error || 'API error');
        }
        return data;
      });
    });
  }

  function showModal(opts) {
    var title = opts.title;
    var fields = opts.fields || [];

    modalTitle.textContent = title;
    modalBody.innerHTML = '';

    var fieldValues = {};

    fields.forEach(function(f) {
      var div = document.createElement('div');
      div.className = 'modal-field';

      var label = document.createElement('label');
      label.textContent = f.label;
      label.setAttribute('for', 'modalField_' + f.id);
      div.appendChild(label);

      var input = document.createElement('input');
      input.type = f.type || 'text';
      input.id = 'modalField_' + f.id;
      input.required = !!f.required;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type === 'color') input.value = '#007aff';
      div.appendChild(input);

      modalBody.appendChild(div);
    });

    modalOverlay.style.display = 'flex';

    return new Promise(function(resolve, reject) {
      modalResolve = function() {
        var values = {};
        fields.forEach(function(f) {
          var input = document.getElementById('modalField_' + f.id);
          values[f.id] = input.value.trim();
        });
        hideModal();
        resolve(values);
      };
      modalReject = function() {
        hideModal();
        reject(new Error('Cancelled'));
      };
    });
  }

  function hideModal() {
    modalOverlay.style.display = 'none';
    modalResolve = null;
    modalReject = null;
  }

  modalCancel.addEventListener('click', function() {
    if (modalReject) modalReject();
  });

  modalSubmit.addEventListener('click', function() {
    if (modalResolve) modalResolve();
  });

  modalOverlay.addEventListener('click', function(e) {
    if (e.target === modalOverlay && modalReject) modalReject();
  });

  addPointBtn.addEventListener('click', function() {
    handleAddPoint();
  });

  function handleCreateRoute() {
    var key = getApiKey();

    function doCreateRoute(k) {
      return showModal({
        title: 'Create Route',
        fields: [
          { id: 'name', label: 'Route Name', type: 'text', required: true },
          { id: 'color', label: 'Color', type: 'color', required: true }
        ]
      }).then(function(vals) {
        return apiCall('create_route', { name: vals.name, color: vals.color, api_key: k });
      }).then(function(res) {
        currentEditingRoute = {
          id: res.data.id,
          name: res.data.name,
          color: res.data.color,
          points: []
        };
        addPointBtn.style.display = 'block';
        menuFinishRoute.style.display = 'block';
        menuCreateRoute.style.display = 'none';
      });
    }

    var ready = key
      ? doCreateRoute(key)      .catch(function(err) {
          if (err.message.indexOf('api_key') !== -1) {
            localStorage.removeItem('api_key');
            return promptForApiKey().then(doCreateRoute);
          }
          alert(err.message);
          throw err;
        })
      : promptForApiKey().then(doCreateRoute);

    ready.catch(function(err) {
      if (err.message !== 'Cancelled') {
        console.error(err);
      }
    });
  }

  function handleAddPoint() {
    if (!currentEditingRoute) return;
    if (!userMarker) {
      alert('No GPS position yet. Please wait for a location fix.');
      return;
    }

    var latlng = userMarker.getLatLng();

    showModal({
      title: 'Add Point',
      fields: [
        { id: 'label', label: 'Label (optional)', type: 'text', required: false, placeholder: 'e.g. Summit' }
      ]
    }).then(function(vals) {
      var key = getApiKey();
      return apiCall('add_point', {
        route_id: currentEditingRoute.id,
        lat: latlng.lat,
        lon: latlng.lng,
        label: vals.label,
        api_key: key
      }).then(function(res) {
        var pt = res.data;
        currentEditingRoute.points.push(pt);

        var latlngArr = [pt.lat, pt.lon];

        if (routePolyline) {
          routePolyline.addLatLng(latlngArr);
        } else {
          routePolyline = L.polyline([latlngArr], {
            color: currentEditingRoute.color,
            weight: 4,
            opacity: 0.8
          }).addTo(map);
        }

        var marker = L.circleMarker(latlngArr, {
          radius: 6,
          fillColor: currentEditingRoute.color,
          color: '#fff',
          weight: 2,
          fillOpacity: 0.9
        }).addTo(map);

        if (pt.label) {
          marker.bindPopup(pt.label);
        }

        routeMarkers.push(marker);
      });
    }).catch(function(err) {
      if (err.message !== 'Cancelled') {
        alert(err.message);
      }
    });
  }

  function handleFinishRoute() {
    currentEditingRoute = null;
    routePolyline = null;
    routeMarkers = [];
    addPointBtn.style.display = 'none';
    menuFinishRoute.style.display = 'none';
    menuCreateRoute.style.display = 'block';
  }

  function loadAllRoutes() {
    apiCall('get_routes', {}).then(function(res) {
      var routes = res.data || [];
      routes.forEach(function(route) {
        if (!route.points || route.points.length === 0) return;

        var latlngs = route.points.map(function(p) {
          return [p.lat, p.lon];
        });

        var poly = L.polyline(latlngs, {
          color: route.color,
          weight: 4,
          opacity: 0.8
        }).addTo(map);

        route.points.forEach(function(p) {
          var marker = L.circleMarker([p.lat, p.lon], {
            radius: 6,
            fillColor: route.color,
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9
          }).addTo(map);

          if (p.label) {
            marker.bindPopup(p.label);
          }
        });
      });
    }).catch(function() {
      // silently fail if no routes
    });
  }

  menuMap.addEventListener('click', function() {
    window.location = 'index.html';
  });

  menuCompass.addEventListener('click', function() {
    window.location = 'compass.html';
  });

  menuCreateRoute.addEventListener('click', function() {
    menuDropdown.classList.remove('open');
    handleCreateRoute();
  });

  menuFinishRoute.addEventListener('click', function() {
    menuDropdown.classList.remove('open');
    handleFinishRoute();
  });

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
  loadAllRoutes();
})();
