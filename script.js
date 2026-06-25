/**
 * Hiking Assistant — real-time GPS tracking map.
 *
 * Renders an interactive Leaflet map that follows the user's position
 * using the HTML5 Geolocation API's watchPosition. Provides custom
 * zoom controls and a center-on-user button.
 *
 * Supports offline route creation and point recording via an
 * offline queue (`OfflineQueue`).  When the network is unavailable
 * API calls are cached in localStorage and replayed in order when
 * the connection returns.  Points appear on the map immediately
 * (optimistic UI) regardless of connectivity.
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
  let currentZoom = (getMapParamsFromURL() || {}).zoom || DEFAULT_ZOOM;

  /** @type {boolean} Whether the map is actively following the user. */
  let followingUser;

  const badgeEl = document.getElementById('locationBadge');

  badgeEl.addEventListener('click', function() {
    if (!map) return;
    var c = userMarker ? userMarker.getLatLng() : map.getCenter();
    var z = map.getZoom();
    var url = new URL(window.location);
    url.searchParams.set('lat', c.lat.toFixed(5));
    url.searchParams.set('long', c.lng.toFixed(5));
    url.searchParams.set('z', z);
    history.replaceState(null, '', url);
  });

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
  const menuSatellite = document.getElementById('menuSatellite');
  const menuCompass = document.getElementById('menuCompass');
  const menuCreateRoute = document.getElementById('menuCreateRoute');
  const menuFinishRoute = document.getElementById('menuFinishRoute');
  const menuAdmin = document.getElementById('menuAdmin');

  /** @type {?function} Pending modal resolve callback, cleared on dismiss. */
  let modalResolve = null;
  /** @type {?function} Pending modal reject callback, cleared on dismiss. */
  let modalReject = null;

  /** @type {Object|null} The route currently being edited ({ id, name, color, points }). */
  let currentEditingRoute = null;
  /** @type {L.Polyline|null} Polyline rendered for the current editing route. */
  let routePolyline = null;
  /** @type {Array<L.CircleMarker>} Circle markers drawn for the current editing route. */
  let routeMarkers = [];

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

  /** @type {{coords: [number,number], zoom: number}?} Map overrides from URL params. */
  const urlMapParams = getMapParamsFromURL();

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
   * Reads the API key from localStorage.
   *
   * @returns {string|null} The stored API key, or null if not set.
   */
  function getApiKey() {
    return localStorage.getItem('api_key') || null;
  }

  /**
   * Persists the API key to localStorage.
   *
   * @param {string} key - The API key to store.
   */
  function setApiKey(key) {
    localStorage.setItem('api_key', key);
  }

  /**
   * Shows a modal prompting the user for their API key.
   *
   * Stores the entered key and returns it.
   *
   * @returns {Promise<string>} A promise that resolves with the entered key.
   */
  function promptForApiKey() {
    return showModal({
      title: 'API Key Required',
      fields: [{ id: 'api_key', label: 'Enter your API key', type: 'text', required: true }]
    }).then(function(vals) {
      setApiKey(vals.api_key);
      return vals.api_key;
    });
  }

  /**
   * Calls the backend API and returns the parsed JSON response.
   *
   * Builds a query string from the action and params, fetches the API,
   * and throws if the response is not successful JSON.
   *
   * On network failure the action is enqueued for later retry via
   * OfflineQueue and the caller receives optimistic mock data so
   * the UI updates immediately even when offline.
   *
   * @param {string} action - The API action name (e.g. "create_route").
   * @param {Object} params - Key-value pairs to send as query parameters.
   * @returns {Promise<Object>} The parsed JSON response body, or mock data
   *   when the request is queued offline.
   */
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
    }).catch(function(err) {
      if (err instanceof TypeError || err.message === 'Failed to fetch' || err.message.indexOf('NetworkError') !== -1 || !navigator.onLine) {
        console.log('Offline: queuing ' + action + ' for later');
        return OfflineQueue.enqueue(action, params);
      }
      throw err;
    });
  }

  /**
   * Renders a modal dialog and returns a promise for the field values.
   *
   * The modal is shown immediately. The promise resolves with an object
   * mapping field IDs to trimmed string values when the user submits.
   * It rejects with a "Cancelled" error if the user dismisses the modal.
   *
   * @param {Object} opts - Modal configuration.
   * @param {string} opts.title - Modal heading text.
   * @param {Array<{id: string, label: string, type: string, required: boolean, placeholder?: string}>} opts.fields - Form fields to render.
   * @returns {Promise<Object>} Resolves with { fieldId: value, ... } on submit.
   */
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

  /**
   * Hides the modal and clears pending resolve/reject callbacks.
   */
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

  /**
   * Orchestrates the full route-creation flow.
   *
   * Obtains or prompts for an API key, shows the name/colour modal,
   * calls the create_route API endpoint, and enters editing mode so
   * the user can start adding points.
   */
  function handleCreateRoute() {
    clearRouteParams();
    var url = new URL(window.location);
    url.searchParams.set('action', 'new');
    history.replaceState(null, '', url.toString());

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
        localStorage.setItem('editing_route', JSON.stringify(currentEditingRoute));
        addPointBtn.style.display = 'block';
        menuFinishRoute.style.display = 'block';
        menuCreateRoute.style.display = 'none';
        clearRouteParams();
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
      clearRouteParams();
    });
  }

  /**
   * Captures the current GPS position as a new point on the editing route.
   *
   * If the user is not in editing mode or has no GPS lock the function
   * returns early with a warning. Otherwise a modal collects an optional
   * label, the point is persisted via the API, and the polyline and
   * marker are added to the map.
   */
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
        localStorage.setItem('editing_route', JSON.stringify(currentEditingRoute));

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
          marker.bindTooltip(pt.label, { permanent: true, direction: 'top', offset: [0, -10] });
        }

        routeMarkers.push(marker);
      });
    }).catch(function(err) {
      if (err.message !== 'Cancelled') {
        alert(err.message);
      }
    });
  }

  /**
   * Exits editing mode while keeping the drawn route on the map.
   *
   * If offline or there are pending queued items the finish is
   * enqueued so that all preceding items are synced before the
   * route is considered complete. Client-side state is always
   * cleaned up immediately for an optimistic UX.
   */
  function handleFinishRoute() {
    clearRouteParams();
    if (!OfflineQueue.isOnline() || !OfflineQueue.isEmpty()) {
      OfflineQueue.enqueue('finish_route', {
        route_id: currentEditingRoute.id,
        name: currentEditingRoute.name
      });
    }
    currentEditingRoute = null;
    routePolyline = null;
    routeMarkers = [];
    localStorage.removeItem('editing_route');
    addPointBtn.style.display = 'none';
    menuFinishRoute.style.display = 'none';
    menuCreateRoute.style.display = 'block';
  }

  /**
   * Fetches all saved routes from the API and renders them on the map.
   *
   * If a route matches the currently-editing route its polyline and
   * marker references are stored so new points can extend them.
   *
   * @param {number[]|null} filterIds - If provided, only routes whose IDs
   *   appear in this array are rendered.  When null, all routes are shown.
   */
  function loadAllRoutes(filterIds) {
    var editingRouteId = currentEditingRoute ? currentEditingRoute.id : null;

    apiCall('get_routes', {}).then(function(res) {
      var routes = res.data || [];
      routes.forEach(function(route) {
        if (filterIds && filterIds.indexOf(route.id) === -1) return;
        if (!route.points || route.points.length === 0) return;

        var latlngs = route.points.map(function(p) {
          return [p.lat, p.lon];
        });

        var poly = L.polyline(latlngs, {
          color: route.color,
          weight: 4,
          opacity: 0.8
        }).addTo(map);

        var isEditing = route.id === editingRouteId;
        if (isEditing) {
          routePolyline = poly;
          routeMarkers = [];
        }

        route.points.forEach(function(p) {
          var marker = L.circleMarker([p.lat, p.lon], {
            radius: 6,
            fillColor: route.color,
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9
          }).addTo(map);

          if (p.label) {
            marker.bindTooltip(p.label, { permanent: true, direction: 'top', offset: [0, -10] });
          }

          if (isEditing) {
            routeMarkers.push(marker);
          }
        });
      });
    }).catch(function() {
      // silently fail if no routes
    });
  }

  /**
   * Restores the editing-mode state from localStorage after a page reload.
   *
   * If a saved editing route is found it is loaded into currentEditingRoute
   * and the Add Point / Finish UI elements are shown.
   */
  function restoreEditingRoute() {
    var saved = localStorage.getItem('editing_route');
    if (!saved) return;
    try {
      currentEditingRoute = JSON.parse(saved);
    } catch (e) {
      localStorage.removeItem('editing_route');
      return;
    }
    addPointBtn.style.display = 'block';
    menuFinishRoute.style.display = 'block';
    menuCreateRoute.style.display = 'none';
  }

  /**
   * Reads repeated `?route=` query parameters from the current URL.
   *
   * Each value is coerced to a number; non-positive values are dropped.
   *
   * @returns {number[]|null} An array of route IDs to display, or null
   *   when no `?route=` params are present (meaning "show all").
   */
  function getRouteParamsFromURL() {
    var params = new URLSearchParams(window.location.search);
    var ids = params.getAll('route').map(Number).filter(function(id) { return id > 0; });
    return ids.length > 0 ? ids : null;
  }

  /**
   * Strips all `?route=` query parameters from the current URL without
   * triggering a page reload (uses history.replaceState).
   */
  function clearRouteParams() {
    var url = new URL(window.location);
    url.searchParams.delete('route');
    url.searchParams.delete('action');
    history.replaceState(null, '', url.toString());
  }

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

  menuCreateRoute.addEventListener('click', function() {
    menuDropdown.classList.remove('open');
    handleCreateRoute();
  });

  menuFinishRoute.addEventListener('click', function() {
    menuDropdown.classList.remove('open');
    handleFinishRoute();
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
    url.searchParams.delete('lat');
    url.searchParams.delete('long');
    url.searchParams.delete('z');
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

  /**
   * When a queued "create_route" item is successfully synced, update the
   * in-memory editing route ID from the temp value to the real server ID
   * so that subsequent point additions use the correct ID.
   */
  OfflineQueue.onRouteCreated = function(tempId, realId) {
    if (currentEditingRoute && currentEditingRoute.id === tempId) {
      currentEditingRoute.id = realId;
      localStorage.setItem('editing_route', JSON.stringify(currentEditingRoute));
    }
  };

  initMap();
  startTracking();
  restoreEditingRoute();
  loadAllRoutes(getRouteParamsFromURL());

  // Flush any offline queue items left over from a previous session.
  OfflineQueue.processQueue();

  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    handleCreateRoute();
  }
})();
