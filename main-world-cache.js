(() => {
    'use strict';

    if (window.__arthasWeekApiCacheInstalled) return;
    window.__arthasWeekApiCacheInstalled = true;

    const CACHE_STORE_KEY = 'arthas-week-graphql-cache-v1';
    const CACHE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
    const CACHE_MAX_ENTRIES = 240;
    const PRELOAD_PREVIOUS_WEEKS = 5;
    const PRELOAD_NEXT_WEEKS = 5;

    const TARGET_OPERATIONS = new Set([
        'getAppointmentsByPerson',
        'fetchAgendaEntriesInRangeByPerson',
        'fetchAppointmentRangeByPerson',
        'fetchAppointmentRangeByTags',
        'fetchAppointmentsForDayForPerson',
        'getTodosByPerson',
        'getAbsencesByPerson',
        'getLeavesByPerson',
        'getOccupiedAppointmentsInRange',
        'getCurrentPeriod',
        'getPreviousPeriod',
        'getNextPeriod',
        'getPeriod',
        'getPeriodDetail',
        'getPeriodExceptions'
    ]);

    const PERIOD_OPERATIONS = new Set([
        'getCurrentPeriod',
        'getPreviousPeriod',
        'getNextPeriod',
        'getPeriod',
        'getPeriodDetail',
        'getPeriodExceptions'
    ]);

    const revalidationInFlight = new Set();
    let storeCache = null;
    let storeDirty = false;
    let saveTimer = null;

    const nativeFetch = typeof window.fetch === 'function'
        ? window.fetch.bind(window)
        : null;

    function safeJsonParse(value) {
        if (typeof value !== 'string' || value.length === 0) return null;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value);
        }

        if (Array.isArray(value)) {
            return `[${value.map((item) => stableStringify(item)).join(',')}]`;
        }

        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    function hashString(input) {
        let hash = 2166136261;
        for (let i = 0; i < input.length; i += 1) {
            hash ^= input.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function parseDate(value) {
        if (typeof value !== 'string') return null;
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;

        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return null;

        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function normalizeDateString(value) {
        const parsed = parseDate(value);
        return parsed ? formatWeekKey(parsed) : value;
    }

    function getIsoWeekStart(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const shift = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - shift);
        return start;
    }

    function formatWeekKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getCurrentWeekKey() {
        return formatWeekKey(getIsoWeekStart(new Date()));
    }

    function parseWeekKey(weekKey) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekKey || '');
        if (!match) return null;

        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return null;

        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addWeeks(weekKey, delta) {
        const date = parseWeekKey(weekKey);
        if (!date) return null;
        date.setDate(date.getDate() + (delta * 7));
        return formatWeekKey(getIsoWeekStart(date));
    }

    function getAllowedWeekKeys() {
        const current = getCurrentWeekKey();
        const allowed = new Set([current]);

        for (let i = 1; i <= PRELOAD_PREVIOUS_WEEKS; i += 1) {
            const key = addWeeks(current, -i);
            if (key) allowed.add(key);
        }

        for (let i = 1; i <= PRELOAD_NEXT_WEEKS; i += 1) {
            const key = addWeeks(current, i);
            if (key) allowed.add(key);
        }

        return allowed;
    }

    function extractWeekKey(variables) {
        if (!variables || typeof variables !== 'object') return null;

        const directCandidates = [
            variables.start,
            variables.from,
            variables.end,
            variables.to,
            variables.now,
            variables.date
        ];

        for (const candidate of directCandidates) {
            const parsed = parseDate(candidate);
            if (parsed) {
                return formatWeekKey(getIsoWeekStart(parsed));
            }
        }

        if (variables.withinDateRange && Array.isArray(variables.withinDateRange)) {
            for (const item of variables.withinDateRange) {
                if (!item || typeof item !== 'object') continue;
                const parsed = parseDate(item.start) || parseDate(item.end);
                if (parsed) {
                    return formatWeekKey(getIsoWeekStart(parsed));
                }
            }
        }

        if (variables.withinDateRange && typeof variables.withinDateRange === 'object') {
            const parsed = parseDate(variables.withinDateRange.start) || parseDate(variables.withinDateRange.end);
            if (parsed) {
                return formatWeekKey(getIsoWeekStart(parsed));
            }
        }

        const queue = [variables];
        let steps = 0;
        while (queue.length > 0 && steps < 96) {
            steps += 1;
            const current = queue.shift();
            if (!current || typeof current !== 'object') continue;

            const nestedCandidates = [
                current.start,
                current.from,
                current.end,
                current.to,
                current.now,
                current.date
            ];

            for (const candidate of nestedCandidates) {
                const parsed = parseDate(candidate);
                if (parsed) {
                    return formatWeekKey(getIsoWeekStart(parsed));
                }
            }

            if (Array.isArray(current)) {
                for (const item of current) {
                    if (item && typeof item === 'object') queue.push(item);
                }
                continue;
            }

            for (const value of Object.values(current)) {
                if (value && typeof value === 'object') queue.push(value);
            }
        }

        return null;
    }

    function normalizeVariablesForKey(operationName, variables) {
        if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
            return {};
        }

        const normalized = { ...variables };

        if (PERIOD_OPERATIONS.has(operationName) && typeof normalized.now === 'string') {
            normalized.now = normalizeDateString(normalized.now);
        }

        return normalized;
    }

    function inferOperationName(payload) {
        if (!payload || typeof payload !== 'object') return '';

        if (typeof payload.operationName === 'string' && payload.operationName.length > 0) {
            return payload.operationName;
        }

        const query = typeof payload.query === 'string' ? payload.query : '';
        const match = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/i);
        return match ? match[1] : '';
    }

    function isMutation(payload) {
        const query = typeof payload?.query === 'string' ? payload.query : '';
        return /^\s*mutation\b/i.test(query);
    }

    function isGraphqlRequest(url, method) {
        if (String(method || 'GET').toUpperCase() !== 'POST') return false;
        const target = String(url || '');
        return /graphql/i.test(target);
    }

    function parseGraphqlBody(bodyText) {
        const parsed = safeJsonParse(bodyText);
        if (!parsed || typeof parsed !== 'object') return null;

        const payload = Array.isArray(parsed)
            ? (parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object' ? parsed[0] : null)
            : parsed;
        if (!payload) return null;
        if (isMutation(payload)) return null;

        const operationName = inferOperationName(payload);
        if (!TARGET_OPERATIONS.has(operationName)) return null;

        const variables = payload.variables && typeof payload.variables === 'object' && !Array.isArray(payload.variables)
            ? payload.variables
            : {};
        const normalizedVariables = normalizeVariablesForKey(operationName, variables);

        const keySource = `${operationName}|${stableStringify(normalizedVariables)}`;
        return {
            operationName,
            variables: normalizedVariables,
            weekKey: extractWeekKey(normalizedVariables),
            keySource,
            key: hashString(keySource)
        };
    }

    function loadStore() {
        if (storeCache) return storeCache;

        const empty = { version: 1, entries: {} };
        const raw = localStorage.getItem(CACHE_STORE_KEY);
        if (!raw) {
            storeCache = empty;
            return storeCache;
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
                storeCache = empty;
                return storeCache;
            }
            storeCache = { version: 1, entries: parsed.entries };
        } catch {
            storeCache = empty;
        }

        return storeCache;
    }

    function queueStoreSave() {
        if (!storeDirty || saveTimer !== null) return;

        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            if (!storeDirty || !storeCache) return;

            try {
                localStorage.setItem(CACHE_STORE_KEY, JSON.stringify(storeCache));
                storeDirty = false;
            } catch {
                // Keep the in-memory cache even if persistence fails.
                storeDirty = false;
            }
        }, 80);
    }

    function pruneStore(store) {
        const now = Date.now();

        const kept = Object.entries(store.entries || {})
            .filter(([, entry]) => {
                if (!entry || typeof entry !== 'object') return false;
                if (typeof entry.body !== 'string') return false;
                if (typeof entry.updatedAt !== 'number') return false;
                if ((now - entry.updatedAt) > CACHE_MAX_AGE_MS) return false;

                return true;
            })
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
            .slice(0, CACHE_MAX_ENTRIES);

        store.entries = Object.fromEntries(kept);
        return store;
    }

    function getCachedEntry(meta) {
        const store = pruneStore(loadStore());
        const entry = store.entries?.[meta.key];
        if (!entry || entry.keySource !== meta.keySource) return null;
        return entry;
    }

    function storeResponse(meta, bodyText, status, statusText, responseHeaders) {
        if (!meta || typeof bodyText !== 'string' || bodyText.length === 0) return;

        const parsed = safeJsonParse(bodyText);
        if (!parsed || typeof parsed !== 'object') return;

        const store = loadStore();
        store.entries[meta.key] = {
            keySource: meta.keySource,
            operationName: meta.operationName,
            weekKey: meta.weekKey,
            updatedAt: Date.now(),
            status: Number.isFinite(status) ? status : 200,
            statusText: typeof statusText === 'string' && statusText.length > 0 ? statusText : 'OK',
            responseHeaders: typeof responseHeaders === 'string' ? responseHeaders : '',
            body: bodyText
        };

        pruneStore(store);
        storeDirty = true;
        queueStoreSave();
    }

    function parseResponseHeaderValue(rawHeaders, headerName) {
        if (!rawHeaders || typeof rawHeaders !== 'string' || !headerName) return null;

        const needle = String(headerName).toLowerCase();
        const lines = rawHeaders.split(/\r?\n/);
        for (const line of lines) {
            const separator = line.indexOf(':');
            if (separator < 0) continue;

            const key = line.slice(0, separator).trim().toLowerCase();
            if (key !== needle) continue;
            return line.slice(separator + 1).trim();
        }

        return null;
    }

    function toHeaderMap(headersLike) {
        if (!headersLike) return {};

        if (headersLike instanceof Headers) {
            const map = {};
            headersLike.forEach((value, key) => {
                map[String(key).toLowerCase()] = String(value);
            });
            return map;
        }

        if (Array.isArray(headersLike)) {
            const map = {};
            for (const pair of headersLike) {
                if (!Array.isArray(pair) || pair.length < 2) continue;
                map[String(pair[0]).toLowerCase()] = String(pair[1]);
            }
            return map;
        }

        if (typeof headersLike === 'object') {
            const map = {};
            for (const [key, value] of Object.entries(headersLike)) {
                map[String(key).toLowerCase()] = String(value);
            }
            return map;
        }

        return {};
    }

    function responseHeadersToString(headers) {
        if (!headers || typeof headers.forEach !== 'function') return '';

        let buffer = '';
        headers.forEach((value, key) => {
            buffer += `${key}: ${value}\r\n`;
        });

        return buffer;
    }

    function responseHeadersStringToObject(rawHeaders) {
        if (!rawHeaders || typeof rawHeaders !== 'string') {
            return { 'content-type': 'application/json' };
        }

        const headers = {};
        const lines = rawHeaders.split(/\r?\n/);
        for (const line of lines) {
            const separator = line.indexOf(':');
            if (separator < 0) continue;

            const key = line.slice(0, separator).trim();
            if (!key) continue;

            headers[key] = line.slice(separator + 1).trim();
        }

        if (!headers['content-type'] && !headers['Content-Type']) {
            headers['content-type'] = 'application/json';
        }

        return headers;
    }

    function getFetchUrl(input) {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
        return '';
    }

    function getFetchMethod(input, init) {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const method = init?.method || (isRequest ? input.method : 'GET');
        return String(method || 'GET').toUpperCase();
    }

    function getFetchHeadersMap(input, init) {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const requestHeaders = isRequest ? toHeaderMap(input.headers) : {};
        const initHeaders = toHeaderMap(init?.headers);
        return {
            ...requestHeaders,
            ...initHeaders
        };
    }

    async function getFetchBodyText(input, init) {
        const initBody = init && Object.prototype.hasOwnProperty.call(init, 'body')
            ? init.body
            : undefined;
        let body = initBody !== undefined ? initBody : null;

        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        if (body === null && isRequest) {
            try {
                body = await input.clone().text();
            } catch {
                body = null;
            }
        }

        if (typeof body === 'string') return body;
        if (body instanceof URLSearchParams) return body.toString();
        return null;
    }

    function revalidateInBackground(url, bodyText, headersMap, meta) {
        if (!nativeFetch || !meta || revalidationInFlight.has(meta.key)) return;

        revalidationInFlight.add(meta.key);

        const requestHeaders = {
            'content-type': 'application/json',
            ...headersMap
        };

        nativeFetch(url, {
            method: 'POST',
            headers: requestHeaders,
            body: bodyText,
            credentials: 'include',
            mode: 'cors',
            cache: 'no-store'
        })
            .then((response) => {
                if (!response.ok) return null;
                return response.text().then((text) => ({ response, text }));
            })
            .then((result) => {
                if (!result) return;
                storeResponse(
                    meta,
                    result.text,
                    result.response.status,
                    result.response.statusText,
                    responseHeadersToString(result.response.headers)
                );
            })
            .catch(() => {
                // Ignore network errors during stale-while-revalidate.
            })
            .finally(() => {
                revalidationInFlight.delete(meta.key);
            });
    }

    if (nativeFetch) {
        try {
            window.fetch = async function patchedFetch(input, init) {
                const url = getFetchUrl(input);
                const method = getFetchMethod(input, init);

                if (!isGraphqlRequest(url, method)) {
                    return nativeFetch(input, init);
                }

                const bodyText = await getFetchBodyText(input, init);
                if (!bodyText) {
                    return nativeFetch(input, init);
                }

                const meta = parseGraphqlBody(bodyText);
                if (!meta) {
                    return nativeFetch(input, init);
                }

                const headersMap = getFetchHeadersMap(input, init);
                const cached = getCachedEntry(meta);
                if (cached) {
                    revalidateInBackground(url, bodyText, headersMap, meta);

                    return new Response(cached.body, {
                        status: Number.isFinite(cached.status) ? cached.status : 200,
                        statusText: cached.statusText || 'OK',
                        headers: responseHeadersStringToObject(
                            cached.responseHeaders || 'content-type: application/json\r\n'
                        )
                    });
                }

                const response = await nativeFetch(input, init);
                try {
                    if (response.ok) {
                        response.clone().text()
                            .then((text) => {
                                if (typeof text !== 'string' || text.length === 0) return;
                                storeResponse(
                                    meta,
                                    text,
                                    response.status,
                                    response.statusText || 'OK',
                                    responseHeadersToString(response.headers)
                                );
                            })
                            .catch(() => {
                                // Ignore cache write errors.
                            });
                    }
                } catch {
                    // Ignore cache write errors.
                }

                return response;
            };
        } catch {
            // Ignore if browser does not allow patching fetch.
        }
    }

    function dispatchCachedEvents(xhr) {
        const createEvent = (type) => {
            try {
                return new ProgressEvent(type);
            } catch {
                return new Event(type);
            }
        };

        window.setTimeout(() => {
            try { xhr.dispatchEvent(createEvent('readystatechange')); } catch {}
            try { xhr.dispatchEvent(createEvent('load')); } catch {}
            try { xhr.dispatchEvent(createEvent('loadend')); } catch {}
        }, 0);
    }

    function applyInstanceStateFallback(xhr, state) {
        const define = (key, value) => {
            try {
                Object.defineProperty(xhr, key, {
                    configurable: true,
                    enumerable: false,
                    writable: false,
                    value
                });
            } catch {
                // Ignore host-object define failures.
            }
        };

        define('readyState', state.readyState);
        define('status', state.status);
        define('statusText', state.statusText);
        define('responseURL', state.responseURL);
        define('responseText', state.responseText);

        if (xhr.responseType === 'json') {
            define('response', state.responseJson);
        } else if (xhr.responseType === '' || xhr.responseType === 'text') {
            define('response', state.responseText);
        }
    }

    const xhrProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!xhrProto) return;

    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;
    const originalSetRequestHeader = xhrProto.setRequestHeader;
    const originalGetResponseHeader = xhrProto.getResponseHeader;
    const originalGetAllResponseHeaders = xhrProto.getAllResponseHeaders;

    function installMockedGetter(property, resolveValue) {
        const descriptor = Object.getOwnPropertyDescriptor(xhrProto, property);
        if (!descriptor || typeof descriptor.get !== 'function' || descriptor.configurable !== true) {
            return;
        }

        Object.defineProperty(xhrProto, property, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: function getPatchedProperty() {
                if (this.__arthasCachedXhrState) {
                    return resolveValue.call(this, this.__arthasCachedXhrState, descriptor);
                }
                return descriptor.get.call(this);
            }
        });
    }

    installMockedGetter('readyState', (state) => state.readyState);
    installMockedGetter('status', (state) => state.status);
    installMockedGetter('statusText', (state) => state.statusText);
    installMockedGetter('responseURL', function resolveResponseUrl(state, descriptor) {
        return state.responseURL || descriptor.get.call(this);
    });
    installMockedGetter('responseText', (state) => state.responseText);
    installMockedGetter('response', function resolveResponse(state, descriptor) {
        if (this.responseType === 'json') return state.responseJson;
        if (this.responseType === '' || this.responseType === 'text') return state.responseText;
        return descriptor.get.call(this);
    });

    try {
        xhrProto.getAllResponseHeaders = function patchedGetAllResponseHeaders() {
            if (this.__arthasCachedXhrState) {
                return this.__arthasCachedXhrState.responseHeaders || 'content-type: application/json\r\n';
            }
            return originalGetAllResponseHeaders.call(this);
        };
    } catch {
        // Ignore if browser does not allow patching this method.
    }

    try {
        xhrProto.getResponseHeader = function patchedGetResponseHeader(name) {
            if (this.__arthasCachedXhrState) {
                return parseResponseHeaderValue(this.__arthasCachedXhrState.responseHeaders, name);
            }
            return originalGetResponseHeader.call(this, name);
        };
    } catch {
        // Ignore if browser does not allow patching this method.
    }

    try {
        xhrProto.open = function patchedOpen(method, url, asyncValue, user, password) {
            this.__arthasRequestInfo = {
                method: String(method || 'GET').toUpperCase(),
                url: String(url || ''),
                headers: {},
                async: asyncValue !== false,
                user,
                password
            };
            this.__arthasCachedXhrState = null;

            return originalOpen.call(this, method, url, asyncValue, user, password);
        };
    } catch {
        // Ignore if browser does not allow patching this method.
    }

    try {
        xhrProto.setRequestHeader = function patchedSetRequestHeader(name, value) {
            if (this.__arthasRequestInfo && name) {
                this.__arthasRequestInfo.headers[String(name).toLowerCase()] = String(value);
            }
            return originalSetRequestHeader.call(this, name, value);
        };
    } catch {
        // Ignore if browser does not allow patching this method.
    }

    try {
        xhrProto.send = function patchedSend(body) {
            const requestInfo = this.__arthasRequestInfo;
            if (!requestInfo || !isGraphqlRequest(requestInfo.url, requestInfo.method)) {
                return originalSend.call(this, body);
            }

            const bodyText = typeof body === 'string'
                ? body
                : (body instanceof URLSearchParams ? body.toString() : null);

            if (!bodyText) {
                return originalSend.call(this, body);
            }

            const meta = parseGraphqlBody(bodyText);
            if (!meta) {
                return originalSend.call(this, body);
            }

            const cached = getCachedEntry(meta);
            if (cached) {
                this.__arthasCachedXhrState = {
                    readyState: 4,
                    status: Number.isFinite(cached.status) ? cached.status : 200,
                    statusText: cached.statusText || 'OK',
                    responseURL: requestInfo.url,
                    responseText: cached.body,
                    responseJson: safeJsonParse(cached.body),
                    responseHeaders: cached.responseHeaders || 'content-type: application/json\r\n'
                };
                applyInstanceStateFallback(this, this.__arthasCachedXhrState);

                revalidateInBackground(requestInfo.url, bodyText, requestInfo.headers, meta);
                dispatchCachedEvents(this);
                return;
            }

            const xhr = this;
            const onLoadEnd = () => {
                xhr.removeEventListener('loadend', onLoadEnd);

                try {
                    if (xhr.status < 200 || xhr.status >= 300) return;

                    const responseText = (xhr.responseType === '' || xhr.responseType === 'text')
                        ? xhr.responseText
                        : (xhr.responseType === 'json' ? JSON.stringify(xhr.response) : null);

                    if (typeof responseText !== 'string' || responseText.length === 0) return;

                    storeResponse(meta, responseText, xhr.status, xhr.statusText || 'OK', xhr.getAllResponseHeaders());
                } catch {
                    // Ignore cache write errors.
                }
            };

            xhr.addEventListener('loadend', onLoadEnd);
            return originalSend.call(this, body);
        };
    } catch {
        // Ignore if browser does not allow patching this method.
    }

    pruneStore(loadStore());
    storeDirty = true;
    queueStoreSave();
})();
