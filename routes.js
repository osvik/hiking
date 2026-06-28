/**
 * Hiking Assistant — route editing, API communication and modal dialogs.
 *
 * Handles creating, editing and finishing hiking routes including
 * point-by-point recording.  Communicates with the PHP API backend
 * and falls back to OfflineQueue when the network is unavailable.
 *
 * @module routes
 */
import { map, userMarker } from './map.js';

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

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalCancel = document.getElementById('modalCancel');
const modalSubmit = document.getElementById('modalSubmit');
const addPointBtn = document.getElementById('addPointBtn');
const menuFinishRoute = document.getElementById('menuFinishRoute');
const menuCreateRoute = document.getElementById('menuCreateRoute');

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
 * Read-only API actions, served by `read.php` so they can be cached
 * separately from mutating requests in a future service worker.
 * @type {string[]}
 */
var readActions = ['get_routes', 'get_route'];

/**
 * Calls the backend API and returns the parsed JSON response.
 *
 * Read-only actions (`get_routes`, `get_route`) are sent to `read.php`;
 * all write actions go to `api.php`.  This separation lays the groundwork
 * for caching `read.php` responses with a service worker later.
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
  var endpoint = readActions.indexOf(action) !== -1 ? 'read.php' : 'api.php';
  var url = endpoint + '?action=' + encodeURIComponent(action);
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
      var firstInvalid = null;
      fields.forEach(function(f) {
        var input = document.getElementById('modalField_' + f.id);
        values[f.id] = input.value.trim();
        if (f.required && values[f.id] === '' && !firstInvalid) {
          firstInvalid = input;
        }
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }
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
    var label = vals.label;

    function doAdd(key) {
      return apiCall('add_point', {
        route_id: currentEditingRoute.id,
        lat: latlng.lat,
        lon: latlng.lng,
        label: label,
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
    }

    function addWithKeyRetry(key) {
      if (!key) {
        return promptForApiKey().then(function(k) { return addWithKeyRetry(k); });
      }
      return doAdd(key).catch(function(err) {
        if (err.message.indexOf('api_key') !== -1) {
          localStorage.removeItem('api_key');
          return promptForApiKey().then(function(k) { return addWithKeyRetry(k); });
        }
        throw err;
      });
    }

    return addWithKeyRetry(getApiKey());
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
  if (currentEditingRoute && (!OfflineQueue.isOnline() || !OfflineQueue.isEmpty())) {
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

export { handleCreateRoute, handleFinishRoute, handleAddPoint, loadAllRoutes, restoreEditingRoute, getRouteParamsFromURL, showModal };
