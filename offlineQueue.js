/**
 * Offline Queue Module
 *
 * Manages a FIFO queue in localStorage for API actions that failed
 * due to network unavailability. Processes queued items sequentially
 * when the browser comes back online, ensuring order is preserved
 * and no item is removed until the server confirms success.
 *
 * Also handles temp-ID-to-real-ID mapping for routes created offline
 * so that subsequently queued points can be linked to the real route.
 *
 * Exposed via `window.OfflineQueue` with these public methods:
 *   - getQueue()      → Array
 *   - enqueue(action, params) → Promise (resolves with mock data)
 *   - dequeue()       → void
 *   - peek()          → Object|null
 *   - isEmpty()       → boolean
 *   - isOnline()      → boolean
 *   - processQueue()  → void (runs sequentially, triggers on 'online' event)
 *   - resolveRouteId(routeId) → number|string
 *   - onRouteCreated  → callback(tempId, realId) — set by consumers
 *
 * @module offlineQueue
 */
(function() {
  /** @constant {string} localStorage key for the offline action queue. */
  var QUEUE_KEY = 'offline_queue';

  /** @constant {string} localStorage key for the temp→real route ID map. */
  var ID_MAP_KEY = 'offline_id_map';

  /** @type {boolean} Guard to prevent concurrent queue processing. */
  var isProcessing = false;

  /**
   * Reads and parses the queue from localStorage.
   *
   * @returns {Array<Object>} The queue array, or a new empty array if
   *   the key is missing or the stored value is not valid JSON.
   */
  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  /**
   * Serializes and writes the queue to localStorage.
   *
   * @param {Array<Object>} queue - The queue array to persist.
   */
  function saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  /**
   * Reads the temp-ID → real-ID mapping from localStorage.
   *
   * @returns {Object<string,number>} Mapping of temp route IDs to real
   *   database IDs, or an empty object if none stored.
   */
  function getTempIdMap() {
    try {
      return JSON.parse(localStorage.getItem(ID_MAP_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  /**
   * Stores a temp-ID → real-ID mapping for a successfully synced route.
   *
   * @param {string} tempId - The client-generated temporary route ID.
   * @param {number} realId - The server-assigned route ID.
   */
  function setTempMapping(tempId, realId) {
    var map = getTempIdMap();
    map[tempId] = realId;
    localStorage.setItem(ID_MAP_KEY, JSON.stringify(map));
  }

  /**
   * Resolves a route ID that may be a temporary client-generated ID.
   *
   * If the given ID starts with "temp_" it is looked up in the mapping;
   * otherwise it is returned as-is.
   *
   * @param {string|number} routeId - The route ID to resolve.
   * @returns {string|number} The real route ID if a mapping exists,
   *   or the original value.
   */
  function resolveRouteId(routeId) {
    if (typeof routeId === 'string' && routeId.indexOf('temp_') === 0) {
      var map = getTempIdMap();
      return map[routeId] || routeId;
    }
    return routeId;
  }

  /**
   * Returns the first item in the queue without removing it.
   *
   * @returns {Object|null} The first queue item, or null if the queue is empty.
   */
  function peek() {
    var queue = getQueue();
    return queue.length > 0 ? queue[0] : null;
  }

  /**
   * Checks whether the offline queue is empty.
   *
   * @returns {boolean} True if the queue has no pending items.
   */
  function isEmpty() {
    return getQueue().length === 0;
  }

  /**
   * Quick online-status check via the browser API.
   *
   * Note: `navigator.onLine` can produce false positives; actual fetch
   * failures are still the ground truth.  Use this only as a hint.
   *
   * @returns {boolean} True if the browser reports being online.
   */
  function isOnlineCheck() {
    return navigator.onLine;
  }

  /**
   * Removes the first item from the queue and persists the change.
   */
  function dequeue() {
    var queue = getQueue();
    if (queue.length > 0) {
      queue.shift();
      saveQueue(queue);
    }
  }

  /**
   * Generates a unique temporary identifier.
   *
   * Format: `temp_<timestamp>_<6 random chars>`
   *
   * @returns {string} A unique temp ID string.
   */
  function generateTempId() {
    return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Appends an action to the offline queue and immediately resolves
   * with optimistic mock data so the caller can update the UI.
   *
   * The mock data shape depends on the action:
   *   - `create_route` → `{ success: true, data: { id: tempId, name, color } }`
   *   - `add_point`    → `{ success: true, data: { id: null, route_id, lat, lon, label, position: -1 } }`
   *   - `finish_route` → `{ success: true }`
   *   - anything else  → `{ success: true }`
   *
   * @param {string} action - The API action name ("create_route", "add_point",
   *   or "finish_route").
   * @param {Object} params - Key-value parameters for the API call.
   * @returns {Promise<Object>} A promise that resolves with mock API response data.
   */
  function enqueue(action, params) {
    return new Promise(function(resolve) {
      var queue = getQueue();
      var itemId = 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      var item = {
        id: itemId,
        action: action,
        params: params,
        timestamp: Date.now()
      };

      if (action === 'create_route') {
        item.tempId = generateTempId();
      }

      queue.push(item);
      saveQueue(queue);

      if (action === 'create_route') {
        resolve({
          success: true,
          data: {
            id: item.tempId,
            name: params.name,
            color: params.color
          }
        });
      } else if (action === 'add_point') {
        resolve({
          success: true,
          data: {
            id: null,
            route_id: params.route_id,
            lat: params.lat,
            lon: params.lon,
            altitude: params.altitude != null ? params.altitude : null,
            label: params.label || '',
            position: -1
          }
        });
      } else if (action === 'finish_route') {
        resolve({ success: true });
      } else {
        resolve({ success: true });
      }
    });
  }

  /**
   * Performs a GET request to the backend API.
   *
   * Builds the full URL from action and params, fetches it, and returns
   * the parsed JSON on success.  Throws on non-JSON responses or when
   * the API reports `success: false`.
   *
   * @param {string} action - The API action name.
   * @param {Object} params - Query parameters to include.
   * @returns {Promise<Object>} The parsed JSON response from the server.
   */
  function doFetch(action, params) {
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
          throw new Error('Server returned non-JSON response (HTTP ' + res.status + ')');
        }
        if (!data.success) {
          throw new Error(data.error || 'API error');
        }
        return data;
      });
    });
  }

  /**
   * Determines whether an Error is the result of a network failure
   * (as opposed to a server-side or application error).
   *
   * Checks several browser-agnostic indicators:
   *   - `navigator.onLine` is false
   *   - The error is a `TypeError` (common for failed `fetch`)
   *   - The message matches "Failed to fetch" (Chrome/Edge)
   *   - The message contains "NetworkError" (Firefox/Safari)
   *
   * @param {Error} err - The error to inspect.
   * @returns {boolean} True if the error is network-related.
   */
  function isNetworkError(err) {
    if (!navigator.onLine) return true;
    if (err instanceof TypeError) return true;
    if (err.message === 'Failed to fetch') return true;
    if (err.message.indexOf('NetworkError') !== -1) return true;
    return false;
  }

  /**
   * Walks the current queue and replaces any `route_id` params that
   * reference the given temp ID with the real server-assigned route ID.
   *
   * Called after a queued `create_route` succeeds so that subsequent
   * `add_point` and `finish_route` items reference the real route.
   *
   * @param {string} tempId - The temp route ID to find and replace.
   * @param {number} realId - The real server-assigned route ID.
   */
  function replaceRouteIdInQueue(tempId, realId) {
    var queue = getQueue();
    var changed = false;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].params && queue[i].params.route_id === tempId) {
        queue[i].params.route_id = realId;
        changed = true;
      }
    }
    if (changed) {
      saveQueue(queue);
    }
  }

  /**
   * Processes the offline queue one item at a time in strict FIFO order.
   *
   * Guard behaviour:
   *   - If already processing, returns immediately (concurrency lock).
   *   - If queue is empty, returns immediately.
   *   - If offline (`!navigator.onLine`), waits for the next `online` event.
   *
   * For `create_route` items:
   *   - Calls the API, stores the temp→real ID mapping on success, then
   *     walks the remaining queue items updating any references to the
   *     old temp ID with the real route ID.
   *
   * For `add_point` items:
   *   - Resolves the route_id (in case it is a temp ID) and calls the API.
   *
   * For `finish_route` items:
   *   - Resolves immediately (no server call — this is client-side only).
   *
   * Error handling:
   *   - Network errors: stop processing and wait for the next `online` event.
   *     The item is NOT dequeued so it will be retried later.
   *   - Non-network errors (4xx/5xx/application errors): the item is logged
   *     and dequeued so it does not permanently block the queue.
   *
   * Recursively calls itself after each item to drain the queue.
   */
  function processQueue() {
    if (isProcessing) return;
    if (isEmpty()) return;
    if (!navigator.onLine) return;

    isProcessing = true;
    var item = peek();
    if (!item) {
      isProcessing = false;
      return;
    }

    var action = item.action;
    var params = item.params || {};
    var promise;

    if (action === 'create_route') {
      promise = doFetch('create_route', params).then(function(data) {
        var tempId = item.tempId;
        var realId = data.data && data.data.id;
        if (tempId && realId) {
          setTempMapping(tempId, realId);
          replaceRouteIdInQueue(tempId, realId);
          if (window.OfflineQueue.onRouteCreated) {
            window.OfflineQueue.onRouteCreated(tempId, realId);
          }
        }
      });
    } else if (action === 'add_point') {
      var resolvedParams = {};
      Object.keys(params).forEach(function(k) {
        resolvedParams[k] = params[k];
      });
      resolvedParams.route_id = resolveRouteId(params.route_id);
      promise = doFetch('add_point', resolvedParams);
    } else if (action === 'finish_route') {
      promise = Promise.resolve();
    } else {
      promise = Promise.resolve();
    }

    promise.then(function() {
      dequeue();
      isProcessing = false;
      processQueue();
    }).catch(function(err) {
      if (isNetworkError(err)) {
        isProcessing = false;
        console.log('Queue processing paused (offline): ' + err.message);
      } else {
        console.error('Queue item failed (non-network), dequeuing: ' + err.message);
        dequeue();
        isProcessing = false;
        processQueue();
      }
    });
  }

  /**
   * Public API surface of the offline queue module.
   *
   * @namespace OfflineQueue
   */
  window.OfflineQueue = {
    /** @see getQueue */
    getQueue: getQueue,

    /** @see enqueue */
    enqueue: enqueue,

    /** @see dequeue */
    dequeue: dequeue,

    /** @see peek */
    peek: peek,

    /** @see isEmpty */
    isEmpty: isEmpty,

    /** @see isOnlineCheck */
    isOnline: isOnlineCheck,

    /** @see processQueue */
    processQueue: processQueue,

    /** @see resolveRouteId */
    resolveRouteId: resolveRouteId,

    /**
     * Callback invoked when a queued `create_route` succeeds.
     *
     * Set by consumers (e.g. `script.js`) to update in-memory state
     * such as the currently-editing route's ID from temp to real.
     *
     * @type {?function(string, number)}
     * @param {string} tempId - The client-generated temporary route ID.
     * @param {number} realId - The server-assigned route ID.
     */
    onRouteCreated: null
  };

  window.addEventListener('online', processQueue);
  window.addEventListener('offline', function() {
    console.log('Gone offline - queue has ' + getQueue().length + ' items pending');
  });
})();
