console.log("ArthasMod: Costume Applied!");

const ARTHAS_THEME_MODE_KEY = 'arthasmod-theme-mode';
const ARTHAS_THEME_MODE = {
    ISY: 'isy',
    ARTHAS: 'arthas'
};
// Seed theme state from the last saved choice so new windows keep the user's style.
let arthasModeEnabled = (() => {
    try {
        const saved = localStorage.getItem(ARTHAS_THEME_MODE_KEY);
        if (saved === ARTHAS_THEME_MODE.ARTHAS) return true;
        return false;
    } catch {
        return false;
    }
})();
let suppressThemeSelectionHandling = false;

const ABSENCE_TABLE_FIX_STYLE_ID = 'arthasmod-absence-table-fix';
const ARTHAS_BRIGHTNESS_STYLE_ID = 'arthasmod-lesson-brightness-style';
const ARTHAS_LESSON_BRIGHTNESS_VAR = '--arthas-lesson-brightness';
const ARTHAS_LESSON_BRIGHTNESS_VALUE_KEY = 'arthasmod-lesson-brightness-value';
const ARTHAS_BASE_UI_STYLE_ID = 'arthasmod-base-ui-style';

function ensureBaseAbsenceTableFixStyles() {
    if (document.getElementById(ABSENCE_TABLE_FIX_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = ABSENCE_TABLE_FIX_STYLE_ID;
    style.textContent = `
/* Absenzübersicht: keep table aligned and symbols fitted in all themes */
[data-v-0eb0dee1] .grid.grid-flow-col.grid-cols-semesterViewColumn {
    box-sizing: border-box !important;
    grid-template-columns: minmax(12rem, 1.15fr) minmax(2.75rem, 0.45fr) repeat(6, minmax(0, 1fr)) !important;
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
}

[data-v-0eb0dee1] .grid.grid-flow-col.grid-cols-semesterViewColumn.w-full,
[data-v-0eb0dee1] .grid.grid-flow-col.grid-cols-semesterViewColumn.w-max {
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
}

[data-v-0eb0dee1] .grid.grid-flow-col.grid-cols-semesterViewColumn > * {
    min-width: 0 !important;
}

[data-v-0eb0dee1] .grid.grid-flow-col.grid-cols-semesterViewColumn.w-full > :nth-child(2) {
    margin-left: 0 !important;
    padding-left: 0.4rem !important;
    padding-right: 0.4rem !important;
    justify-content: center !important;
}

[data-v-0eb0dee1] [data-type="absences"] .flex.w-full {
    display: flex !important;
    flex-wrap: nowrap !important;
    gap: 1px !important;
    min-width: 0 !important;
}

[data-v-0eb0dee1] [data-type="absences"] [data-message-iri] {
    flex: 1 1 0 !important;
    width: auto !important;
    min-width: 0.72rem !important;
    max-width: 1.35rem !important;
    min-height: 0.72rem !important;
    aspect-ratio: 1 / 1 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
}

[data-v-0eb0dee1] [data-type="absences"] [data-message-iri] > div,
[data-v-0eb0dee1] [data-type="absences"] [data-message-iri] > div > div {
    width: 100% !important;
    height: 100% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
}

[data-v-0eb0dee1] [data-type="absences"] [data-message-iri] i,
[data-v-0eb0dee1] [data-type="absences"] [data-message-iri] svg {
    font-size: clamp(0.68rem, 0.95vw, 0.95rem) !important;
    width: clamp(0.68rem, 0.95vw, 0.95rem) !important;
    height: clamp(0.68rem, 0.95vw, 0.95rem) !important;
}
`;

    (document.head || document.documentElement).appendChild(style);
}

function normalizeThemeModePreference(value) {
    if (value === ARTHAS_THEME_MODE.ISY) return ARTHAS_THEME_MODE.ISY;
    if (value === ARTHAS_THEME_MODE.ARTHAS) return ARTHAS_THEME_MODE.ARTHAS;
    return null;
}

function readThemeModePreferenceFromLocalStorage() {
    try {
        return normalizeThemeModePreference(localStorage.getItem(ARTHAS_THEME_MODE_KEY));
    } catch {
        return null;
    }
}

function readThemeModePreferenceFromStorage() {
    try {
        if (!chrome?.storage?.local?.get) return Promise.resolve(null);
        const maybePromise = chrome.storage.local.get(ARTHAS_THEME_MODE_KEY);
        if (maybePromise && typeof maybePromise.then === 'function') {
            return maybePromise
                .then((result) => normalizeThemeModePreference(result?.[ARTHAS_THEME_MODE_KEY]))
                .catch(() => null);
        }
        return new Promise((resolve) => {
            chrome.storage.local.get(ARTHAS_THEME_MODE_KEY, (result) => {
                resolve(normalizeThemeModePreference(result?.[ARTHAS_THEME_MODE_KEY]));
            });
        });
    } catch {
        return Promise.resolve(null);
    }
}

function writeThemeModePreference(mode) {
    const normalized = normalizeThemeModePreference(mode);
    if (!normalized) return;
    try {
        localStorage.setItem(ARTHAS_THEME_MODE_KEY, normalized);
    } catch {
        // Ignore persistence errors.
    }
    try {
        chrome?.storage?.local?.set?.({ [ARTHAS_THEME_MODE_KEY]: normalized });
    } catch {
        // Ignore persistence errors.
    }
}

const ARTHAS_STYLESHEET_ID = 'arthasmod-theme-styles';

function findArthasExtensionStylesheets() {
    const runtimeId = chrome.runtime?.id;
    const targetHref = runtimeId ? `chrome-extension://${runtimeId}/styles.css` : '/styles.css';
    const matches = [];

    Array.from(document.styleSheets || []).forEach((sheet) => {
        const href = sheet?.href || '';
        if (href.includes(targetHref)) {
            matches.push(sheet);
        }
    });

    return matches;
}

function ensureArthasStylesheetNode() {
    let node = document.getElementById(ARTHAS_STYLESHEET_ID);
    if (node) return node;

    node = document.createElement('link');
    node.id = ARTHAS_STYLESHEET_ID;
    node.rel = 'stylesheet';
    node.href = chrome.runtime.getURL('styles.css');

    (document.head || document.documentElement).appendChild(node);
    return node;
}

function toggleArthasStylesheet(enabled) {
    // Handle any existing stylesheet (including old auto-injected ones).
    findArthasExtensionStylesheets().forEach((sheet) => {
        try {
            sheet.disabled = !enabled;
        } catch {
            // Ignore cross-origin/CSSOM edge cases.
        }

        const owner = sheet.ownerNode;
        if (owner && 'disabled' in owner) {
            owner.disabled = !enabled;
        }
    });

    if (enabled) {
        const injectedNode = ensureArthasStylesheetNode();
        injectedNode.disabled = false;
    } else {
        const injectedNode = document.getElementById(ARTHAS_STYLESHEET_ID);
        if (injectedNode) {
            injectedNode.disabled = true;
            injectedNode.remove();
        }
    }
}

function ensureBaseUiStyles() {
    if (document.getElementById(ARTHAS_BASE_UI_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = ARTHAS_BASE_UI_STYLE_ID;
    style.textContent = `
body:not(.ArthasMod-enabled) .arthasmod-update-control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 2.4rem;
    padding: 0.48rem 0.95rem;
    border-radius: 12px;
    font-weight: 700;
    letter-spacing: 0.01em;
    text-decoration: none;
    background: linear-gradient(135deg, var(--primary-color, #4164ff), #2e4ad9) !important;
    color: #fff !important;
    border: 1px solid rgba(46, 74, 217, 0.8) !important;
    box-shadow: none !important;
    transition: transform 140ms ease, opacity 120ms ease, border-color 140ms ease, background 160ms ease;
    cursor: pointer;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button:hover {
    transform: translateY(-1px);
    border-color: rgba(46, 74, 217, 0.9) !important;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button:active {
    transform: translateY(0);
    opacity: 0.92;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button:focus-visible {
    outline: 2px solid var(--primary-color, #4164ff);
    outline-offset: 2px;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button:disabled {
    opacity: 0.58;
    cursor: not-allowed;
    transform: none;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button.ghost {
    background: var(--isy-panel-bg, rgba(255, 255, 255, 0.92)) !important;
    color: var(--primary-color, #4164ff) !important;
    border: 1px solid rgba(46, 74, 217, 0.38) !important;
    box-shadow: none !important;
}

body:not(.ArthasMod-enabled) .arthasmod-update-control .arthasmod-button.ghost:hover {
    background: rgba(65, 100, 255, 0.08) !important;
}

body:not(.ArthasMod-enabled) .arthasmod-update-status {
    color: var(--font-passive, #4b5563);
    font-size: 0.95rem;
    min-height: 1.1em;
}

body:not(.ArthasMod-enabled) .arthasmod-update-status[data-tone="ok"] { color: #15803d; }
body:not(.ArthasMod-enabled) .arthasmod-update-status[data-tone="info"] { color: #1d4ed8; }
body:not(.ArthasMod-enabled) .arthasmod-update-status[data-tone="warn"] { color: #b45309; }
body:not(.ArthasMod-enabled) .arthasmod-update-status[data-tone="error"] { color: #b91c1c; }

body:not(.ArthasMod-enabled) .arthasmod-version {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-right: 0.45rem;
    padding: 0.24rem 0.6rem;
    border-radius: 999px;
    border: 1px solid rgba(46, 74, 217, 0.22);
    background: linear-gradient(135deg, rgba(65, 100, 255, 0.15), rgba(46, 74, 217, 0.12));
    color: var(--font-color, #0f172a);
    font-size: 0.98rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    text-decoration: none !important;
}

body:not(.ArthasMod-enabled) .arthasmod-version:hover {
    border-color: rgba(46, 74, 217, 0.45);
    background: linear-gradient(135deg, rgba(65, 100, 255, 0.24), rgba(46, 74, 217, 0.18));
}
`;

    (document.head || document.documentElement).appendChild(style);
}

function removeArthasFooterDecorations() {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    footer.classList.remove('isy-footer-themed');
}

function removeArthasTimetableClasses() {
    const timetableClasses = [
        'isy-tt-past-lesson',
        'isy-tt-exam-text',
        'isy-tt-canceled-task-text',
        'isy-tt-canceled-text',
        'isy-tt-absence-text',
        'isy-tt-shifted-text',
        'isy-tt-special-text'
    ];

    document.querySelectorAll(TIMETABLE_ENTRY_SELECTOR).forEach((entry) => {
        entry.classList.remove(...timetableClasses);
    });
}

function isArthasModeEnabled() {
    return arthasModeEnabled;
}

function applyArthasModeStateToDom(enabled) {
    arthasModeEnabled = enabled;
    if (document.body) {
        document.body.classList.toggle('ArthasMod-enabled', enabled);
    }
    toggleArthasStylesheet(enabled);
    if (!enabled) {
        removeArthasFooterDecorations();
        removeCachedTimetableOverlay();
        removeArthasTimetableClasses();
    }
    decorateFooter();
}

// Optional: Add a subtle entry animation trigger for elements that load later
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && node.classList && node.classList.contains('message-preview')) {
                node.style.animation = 'fadeInUp 0.3s ease backwards';
            }
        });
    });
});

function parsePercentVariable(styleText, variableName) {
    const directMatch = styleText.match(new RegExp(`${variableName}\\s*:\\s*([-\\d.]+)%`, 'i'));
    if (directMatch) return parseFloat(directMatch[1]);

    const calcMatch = styleText.match(new RegExp(`${variableName}\\s*:\\s*calc\\(([-\\d.]+)%`, 'i'));
    if (calcMatch) return parseFloat(calcMatch[1]);

    return null;
}

function parseHeaderDate(text) {
    const match = text.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\s*[.\-/]\s*(\d{2,4}))?/);
    if (!match) return null;

    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;

    const now = new Date();
    let year = now.getFullYear();
    if (match[3]) {
        year = Number.parseInt(match[3], 10);
        if (!Number.isFinite(year)) return null;
        if (match[3].length === 2) year += year >= 70 ? 1900 : 2000;
    } else {
        const currentMonth = now.getMonth() + 1;
        if (currentMonth === 1 && month === 12) year -= 1;
        if (currentMonth === 12 && month === 1) year += 1;
    }

    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getStartOfIsoWeek(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOffset);
    return start;
}

function formatDateAsWeekKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getCurrentWeekKey() {
    return formatDateAsWeekKey(getStartOfIsoWeek(new Date()));
}

function getWeekKeyFromDates(dates) {
    if (!dates.length) return null;

    const minDate = dates.reduce((min, current) => (current < min ? current : min), dates[0]);
    return formatDateAsWeekKey(getStartOfIsoWeek(minDate));
}

function parseWeekKey(weekKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekKey || '');
    if (!match) return null;

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function addWeeksToWeekKey(weekKey, deltaWeeks) {
    const date = parseWeekKey(weekKey);
    if (!date) return null;

    date.setDate(date.getDate() + (deltaWeeks * 7));
    return formatDateAsWeekKey(getStartOfIsoWeek(date));
}

function getDisplayedWeekStatus(headerColumns) {
    const dates = headerColumns
        .map((column) => parseHeaderDate(column.textContent || ''))
        .filter(Boolean);

    if (dates.length === 0) return 'unknown';

    const minDate = dates.reduce((min, current) => (current < min ? current : min), dates[0]);
    const maxDate = dates.reduce((max, current) => (current > max ? current : max), dates[0]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (maxDate < today) return 'past';
    if (minDate > today) return 'future';
    return 'current';
}

function getCurrentTimePercent() {
    const currentLine = document.querySelector('.time-line-container .current-time, .current-time');
    if (!currentLine) return null;

    const styleText = (currentLine.getAttribute('style') || '').toLowerCase();
    const inlineTop = parsePercentVariable(styleText, 'top')
        ?? parsePercentVariable(styleText, '--top');
    if (inlineTop !== null && !Number.isNaN(inlineTop)) return inlineTop;

    const container = currentLine.closest('.time-line-container');
    if (!container) return null;

    const lineRect = currentLine.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (containerRect.height <= 0) return null;

    return ((lineRect.top - containerRect.top) / containerRect.height) * 100;
}

function applyPastLessonClasses(entries) {
    const allDayColumns = Array.from(document.querySelectorAll('.day-all-container .day-all-column, .day-all-container .calendar-week-day'))
        .filter((column) => !isInsideCachedTimetableOverlay(column));
    const headerColumns = Array.from(document.querySelectorAll('.day-header-container .calendar-week-day'))
        .filter((column) => !isInsideCachedTimetableOverlay(column));
    const dayColumns = Array.from(document.querySelectorAll('.day-container .calendar-week-day'))
        .filter((column) => !column.classList.contains('calendar-week-day--all-day'))
        .filter((column) => !isInsideCachedTimetableOverlay(column));
    const currentTimePercent = getCurrentTimePercent();
    const weekStatus = getDisplayedWeekStatus(headerColumns);

    let todayIndex = -1;

    if (headerColumns.length > 0) {
        todayIndex = headerColumns.findIndex((column) => Boolean(
            column.querySelector('.calendar-week-day-header.today, .calendar-week-day-header .today, .today')
        ));
    }

    if (todayIndex < 0) {
        todayIndex = dayColumns.findIndex((column) => Boolean(
            column.classList.contains('today') || column.querySelector('.calendar-week-day-header.today, .today')
        ));
    }

    if (todayIndex < 0 && dayColumns.length === 1) {
        todayIndex = 0;
    }

    entries.forEach((entry) => {
        entry.classList.remove('isy-tt-past-lesson');

        const wrapper = entry.closest('.calendar-week-element');
        if (!wrapper) return;

        const scope = wrapper.getAttribute('data-scope');
        const styleText = (wrapper.getAttribute('style') || '').toLowerCase();
        let isPast = false;

        if (weekStatus === 'past') {
            isPast = true;
        } else if (weekStatus === 'future') {
            isPast = false;
        } else if (scope === 'allDay') {
            const allDayColumn = wrapper.closest('.day-all-column, .calendar-week-day');
            const allDayIndex = allDayColumns.indexOf(allDayColumn);
            if (todayIndex >= 0 && allDayIndex >= 0) {
                isPast = allDayIndex < todayIndex;
            }
        } else {
            const dayColumn = wrapper.closest('.calendar-week-day');
            const dayIndex = dayColumns.indexOf(dayColumn);

            if (todayIndex >= 0 && dayIndex >= 0) {
                if (dayIndex < todayIndex) {
                    isPast = true;
                } else if (dayIndex === todayIndex && currentTimePercent !== null) {
                    const top = parsePercentVariable(styleText, '--top');
                    const height = parsePercentVariable(styleText, '--height');
                    if (top !== null && height !== null) {
                        isPast = (top + height) <= (currentTimePercent + 0.1);
                    }
                }
            } else if (todayIndex < 0 && dayColumns.length === 1 && currentTimePercent !== null) {
                const top = parsePercentVariable(styleText, '--top');
                const height = parsePercentVariable(styleText, '--height');
                if (top !== null && height !== null) {
                    isPast = (top + height) <= (currentTimePercent + 0.1);
                }
            }
        }

        if (isPast) {
            entry.classList.add('isy-tt-past-lesson');
        }
    });
}

function applyTimetableClasses(entries) {
    if (!isArthasModeEnabled()) return;

    const safeEntries = Array.isArray(entries)
        ? entries.filter((entry) => entry && typeof entry.closest === 'function')
        : [];

    if (safeEntries.length === 0) return;

    try {
        applyTimetableSpecialCaseClasses(safeEntries);
        applyPastLessonClasses(safeEntries);
    } catch (error) {
        console.warn('Isy Modernizer: applyTimetableClasses failed.', error);
    }
}

function applyTimetableSpecialCaseClasses(entries) {
    entries.forEach((entry) => {
        const wrapper = entry.closest('.calendar-week-element');
        const labelText = (entry.querySelector('.content-header-label span')?.textContent || '')
            .toLowerCase()
            .replace(/\u00e4/g, 'ae')
            .replace(/\u00f6/g, 'oe')
            .replace(/\u00fc/g, 'ue')
            .replace(/\u00df/g, 'ss');
        const classText = `${entry.className || ''} ${wrapper?.className || ''}`.toLowerCase();
        const styleText = `${entry.getAttribute('style') || ''} ${wrapper?.getAttribute('style') || ''}`.toLowerCase();
        const hasClass = (className) => classText.includes(className.toLowerCase());

        entry.classList.remove(
            'isy-tt-exam-text',
            'isy-tt-canceled-task-text',
            'isy-tt-canceled-text',
            'isy-tt-absence-text',
            'isy-tt-shifted-text',
            'isy-tt-special-text'
        );

        const hasStrikeThrough = hasClass('line-through')
            || styleText.includes('line-through')
            || Boolean(entry.querySelector('.line-through, [class*="line-through"], [style*="line-through"]'));

        const isBlueLesson = styleText.includes('31, 161, 219')
            || styleText.includes('31,161,219')
            || styleText.includes('173, 226, 252')
            || styleText.includes('173,226,252');
        const isShifted = labelText.includes('verschoben')
            || labelText.includes('verlegt')
            || labelText.includes('shifted')
            || hasClass('calendar-coloring--isshifted')
            || hasClass('calendar-coloring--ispredecessorshifted')
            || styleText.includes('253, 146, 0')
            || styleText.includes('253,146,0');
        const isCanceled = labelText.includes('entfaellt')
            || labelText.includes('entfallt')
            || labelText.includes('faellt aus')
            || labelText.includes('ausfall')
            || labelText.includes('cancel')
            || hasClass('calendar-coloring--iscanceled')
            || styleText.includes('242, 242, 242')
            || styleText.includes('242,242,242')
            || hasStrikeThrough;
        const hasTask = labelText.includes('auftrag')
            || labelText.includes('task')
            || hasClass('calendar-coloring--hasregistration')
            || styleText.includes('253, 242, 141')
            || styleText.includes('253,242,141');
        const isSpecial = labelText.includes('sonder')
            || labelText.includes('special')
            || hasClass('calendar-coloring--iscollection')
            || styleText.includes('211, 211, 211')
            || styleText.includes('211,211,211');
        const isAbsence = labelText.includes('absence')
            || labelText.includes('abwesen')
            || hasClass('calendar-coloring--isabsence');

        const isExam = (labelText.includes('pruefung')
            || labelText.includes('prufung')
            || labelText.includes('klausur')
            || labelText.includes('exam')
            || hasClass('calendar-coloring--isexam')
            || isBlueLesson) && !isCanceled;

        if (isCanceled && (hasTask || isBlueLesson)) {
            entry.classList.add('isy-tt-canceled-task-text');
        } else if (isCanceled) {
            entry.classList.add('isy-tt-canceled-text');
        } else if (isExam) {
            entry.classList.add('isy-tt-exam-text');
        } else if (isAbsence) {
            entry.classList.add('isy-tt-absence-text');
        } else if (isShifted) {
            entry.classList.add('isy-tt-shifted-text');
        } else if (isSpecial) {
            entry.classList.add('isy-tt-special-text');
        }
    });
}

let timetablePastRefreshInterval = null;
function ensureTimetablePastRefresh() {
    if (timetablePastRefreshInterval !== null) return;

    timetablePastRefreshInterval = window.setInterval(() => {
        if (!isArthasModeEnabled()) return;
        if (!window.location.href.includes('timetable')) return;

        const realItems = Array.from(document.querySelectorAll(TIMETABLE_ENTRY_SELECTOR))
            .filter((el) => !isInsideCachedTimetableOverlay(el));
        if (realItems.length > 0) {
            applyPastLessonClasses(realItems);
        }
    }, 60000);
}


// --- Timetable Caching Logic ---
const TIMETABLE_CACHE_STORE_KEY = 'isy-timetable-week-cache-v2';
const LEGACY_CACHE_KEY = 'isy-timetable-cache';
const LEGACY_CACHE_TIMESTAMP_KEY = 'isy-timetable-timestamp';
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PRELOAD_PREVIOUS_WEEKS = 5;
const PRELOAD_NEXT_WEEKS = 5;
const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || 'dev';
const UPDATE_RELEASE_URL = 'https://github.com/Arthas1811/ArthasMod';
const UPDATE_CONTAINER_CLASS = 'arthasmod-update-control';
const UPDATE_BUTTON_ID = 'arthasmod-update-check';
const UPDATE_APPLY_BUTTON_ID = 'arthasmod-update-apply';
const UPDATE_STATUS_ID = 'arthasmod-update-status';

function syncArthasVersionLabels() {
    const text = `ArthasMod v.${EXTENSION_VERSION}`;
    const links = Array.from(document.querySelectorAll('.arthasmod-version'));
    links.forEach((node) => {
        node.textContent = text;
        if (node instanceof HTMLAnchorElement) {
            node.href = 'https://github.com/Arthas1811';
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
        }
    });
}

let timetablePreloadPromise = null;
let activePreloadAnchorWeekKey = null;
let lastPreloadedAnchorWeekKey = null;

function shouldShowTimetableOverlay() {
    if (!isArthasModeEnabled()) return false;

    const href = window.location.href.toLowerCase();
    let pathname = '';
    try {
        pathname = new URL(window.location.href).pathname.toLowerCase();
    } catch {
        pathname = '';
    }

    // Only allow overlay on the real timetable overview route to avoid flicker on other menu pages.
    if (!/^\/timetable(\/overview)?\/?$/.test(pathname)) return false;
    if (!href.includes('timetable')) return false;

    // Do not show cached timetable overlay on entry/create/edit views.
    if (/(add|new|create|neu|erstellen|appointment|termin|erfassen|edit|bearbeiten)/.test(href)) return false;
    // Do not show it on non-timetable sections that can live under timetable routes.
    if (/(pruef|pruf|exam|absenz|absence|abwesen|uebersicht)/.test(href)) return false;

    // Extra safety for SPA states where URL is ambiguous but a form is already visible.
    if (document.querySelector('.form-container input, .form-container textarea, .form-container select')) return false;

    return true;
}

function removeCachedTimetableOverlay() {
    const overlay = document.getElementById('isy-cached-timetable');
    if (overlay) overlay.remove();
}

function hasRealTimetableScaffoldOrMount() {
    return Array.from(document.querySelectorAll(TIMETABLE_SCOPE_SELECTOR))
        .some((el) => !isInsideCachedTimetableOverlay(el));
}

function decorateFooter() {
    const footer = document.querySelector('.footer');
    if (!footer) return;

    footer.classList.toggle('isy-footer-themed', isArthasModeEnabled());

    const rightArea = footer.querySelector('.w-36.text-right') || footer.lastElementChild;
    if (!rightArea) return;

    let versionEl = rightArea.querySelector('.arthasmod-version');
    if (!versionEl) {
        versionEl = document.createElement('a');
        versionEl.className = 'arthasmod-version';
        rightArea.prepend(versionEl);
    }

    versionEl.dataset.theme = isArthasModeEnabled() ? 'arthas' : 'default';
    syncArthasVersionLabels();
}




function applyNativeDarkPresetForArthas() {
    const root = document.documentElement;
    root.classList.add('dark');
    root.setAttribute('theme', 'dark');

    const darkInput = document.getElementById('settingsDarkMode');
    const whiteInput = document.getElementById('settingsWhiteMode');
    const darkLabel = document.querySelector('label[for="settingsDarkMode"]');

    if (!darkInput) return;

    suppressThemeSelectionHandling = true;
    try {
        if (whiteInput) {
            whiteInput.checked = false;
            whiteInput.dispatchEvent(new Event('input', { bubbles: true }));
            whiteInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        darkInput.checked = true;
        darkInput.dispatchEvent(new Event('input', { bubbles: true }));
        darkInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Trigger the same path as native user interaction so ISY swaps all dark assets.
        if (darkLabel) {
            darkLabel.click();
        }

        applyDarkSliderPresetForArthas(true);
    } finally {
        suppressThemeSelectionHandling = false;
    }
}


function getDisplayModeSlider() {
    return document.querySelector('.display-mode-container .range-slider');
}

function readArthasLessonBrightnessSliderValue() {
    try {
        const value = localStorage.getItem(ARTHAS_LESSON_BRIGHTNESS_VALUE_KEY);
        return value;
    } catch {
        return null;
    }
}

function writeArthasLessonBrightnessSliderValue(value) {
    try {
        localStorage.setItem(ARTHAS_LESSON_BRIGHTNESS_VALUE_KEY, String(value));
    } catch {
        // Ignore persistence failures.
    }
}

function applySavedArthasBrightnessToSlider(slider, emitEvents = false) {
    if (!slider) return;

    const saved = readArthasLessonBrightnessSliderValue();
    const fallback = getArthasDarkSliderValue(slider);
    const target = saved ?? fallback;

    suppressThemeSelectionHandling = true;
    try {
        slider.value = String(target);
        slider.setAttribute('value', String(target));
        if (emitEvents) {
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } finally {
        suppressThemeSelectionHandling = false;
    }

    setArthasLessonBrightnessFromSlider(slider);
}

function ensureArthasLessonBrightnessStyle() {
    if (document.getElementById(ARTHAS_BRIGHTNESS_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = ARTHAS_BRIGHTNESS_STYLE_ID;
    style.textContent = `
body.ArthasMod-enabled .calendar-week-element-inner,
body.ArthasMod-enabled .calendar-week-element .calendar-week-element-inner {
    position: relative !important;
    overflow: hidden !important;
}

body.ArthasMod-enabled .calendar-week-element-inner::after,
body.ArthasMod-enabled .calendar-week-element .calendar-week-element-inner::after {
    content: "" !important;
    position: absolute !important;
    inset: 0 !important;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.46)) !important;
    opacity: var(${ARTHAS_LESSON_BRIGHTNESS_VAR}, 0) !important;
    pointer-events: none !important;
    z-index: 0 !important;
}
`;

    (document.head || document.documentElement).appendChild(style);
}

function setArthasLessonBrightnessFromSlider(slider) {
    if (!slider) return;

    const min = Number.parseFloat(slider.min || '0');
    const max = Number.parseFloat(slider.max || '100');
    const value = Number.parseFloat(slider.value || String(max));

    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        document.documentElement.style.setProperty(ARTHAS_LESSON_BRIGHTNESS_VAR, '1');
        return;
    }

    writeArthasLessonBrightnessSliderValue(slider.value);

    // Slider max keeps current colors (brightest). Lower values add darker overlay.
    const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)));
    const darkenOpacity = 0.48 * (1 - normalized);
    document.documentElement.style.setProperty(ARTHAS_LESSON_BRIGHTNESS_VAR, darkenOpacity.toFixed(3));
}

function getArthasDarkSliderValue(slider) {
    if (!slider) return '100';
    return slider.max || '100';
}

function applyDarkSliderPresetForArthas(emitEvents = true) {
    const slider = getDisplayModeSlider();
    if (!slider) return;

    const targetValue = getArthasDarkSliderValue(slider);
    if (String(slider.value) === String(targetValue)) return;

    suppressThemeSelectionHandling = true;
    try {
        slider.value = targetValue;
        slider.setAttribute('value', String(targetValue));
        if (emitEvents) {
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } finally {
        suppressThemeSelectionHandling = false;
    }
}

function scheduleArthasDarkPresetReapply() {
    const delays = [0, 80, 220, 500, 1000];
    delays.forEach((delay) => {
        window.setTimeout(() => {
            if (!isArthasModeEnabled()) return;
            applyNativeDarkPresetForArthas();
            applyDarkSliderPresetForArthas(true);
        }, delay);
    });
}

function syncArthasSliderLockState() {
    const slider = getDisplayModeSlider();
    if (!slider) return;

    const arthasEnabled = isArthasModeEnabled();
    slider.disabled = false;

    if (arthasEnabled) {
        slider.style.opacity = '';
        slider.style.cursor = '';
        slider.title = 'ArthasMod: Regelt die Helligkeit der Lektionen.';
        applySavedArthasBrightnessToSlider(slider, false);
    } else {
        slider.style.opacity = '';
        slider.style.cursor = '';
        slider.title = '';
        document.documentElement.style.setProperty(ARTHAS_LESSON_BRIGHTNESS_VAR, '1');
    }
}

function setArthasModeEnabled(enabled, persist = true) {
    if (enabled) {
        // Force native dark mode first so ISY swaps non-customized assets.
        applyNativeDarkPresetForArthas();
    }

    applyArthasModeStateToDom(enabled);

    if (persist) {
        writeThemeModePreference(enabled ? ARTHAS_THEME_MODE.ARTHAS : ARTHAS_THEME_MODE.ISY);
    }

    if (enabled) {
        const slider = getDisplayModeSlider();
        applySavedArthasBrightnessToSlider(slider, true);
        initializeArthasFeatures();
    } else {
        document.documentElement.style.setProperty(ARTHAS_LESSON_BRIGHTNESS_VAR, '1');
    }

    syncArthasModeOptionState();
    syncArthasSliderLockState();
}

function buildArthasModeOption() {
    const template = document.querySelector('#settingsDarkMode')?.closest('.radio-button-container.display-radio')
        || document.querySelector('#settingsWhiteMode')?.closest('.radio-button-container.display-radio');

    const wrapper = template ? template.cloneNode(true) : document.createElement('div');
    if (!template) {
        wrapper.className = 'radio-button-container display-radio ml-2';
        wrapper.innerHTML = '<label class="radio-button" for="settingsArthasMode" tabindex="0"><div class="circle-container mr-1"><div class="outer-circle"><div class="inner-circle"></div></div></div><span>ArthasMod</span></label><input id="settingsArthasMode" type="radio" hidden="" name="settingsDisplayMode">';
    }

    wrapper.classList.add('arthasmod-theme-option');
    wrapper.classList.remove('mr-2');
    wrapper.classList.add('ml-2');

    const label = wrapper.querySelector('label.radio-button');
    if (label) {
        label.setAttribute('for', 'settingsArthasMode');
        label.setAttribute('tabindex', '0');

        const spanCandidates = Array.from(label.querySelectorAll('span'));
        const textSpan = spanCandidates[spanCandidates.length - 1];
        if (textSpan) textSpan.textContent = 'ArthasMod';
    }

    const input = wrapper.querySelector('input[type="radio"]') || document.createElement('input');
    input.id = 'settingsArthasMode';
    input.type = 'radio';
    input.hidden = true;
    input.name = 'settingsDisplayMode';
    input.checked = false;

    if (!input.parentElement) {
        wrapper.appendChild(input);
    }

    const innerCircle = wrapper.querySelector('.inner-circle');
    if (innerCircle) {
        innerCircle.style.background = 'var(--primary-color)';
        innerCircle.style.display = 'none';
    }

    return wrapper;
}

function syncArthasModeOptionState() {
    const arthasInput = document.getElementById('settingsArthasMode');
    if (!arthasInput) return;

    const arthasEnabled = isArthasModeEnabled();
    arthasInput.checked = arthasEnabled;

    const arthasInnerCircle = arthasInput
        .closest('.arthasmod-theme-option')
        ?.querySelector('.inner-circle');
    if (arthasInnerCircle) {
        arthasInnerCircle.style.display = arthasEnabled ? '' : 'none';
    }

    // Prevent double-selected visuals: hide native mode dots while Arthas mode is active.
    const nativeModeDots = document.querySelectorAll(
        'label[for="settingsWhiteMode"] .inner-circle, label[for="settingsDarkMode"] .inner-circle'
    );
    nativeModeDots.forEach((dot) => {
        dot.style.display = arthasEnabled ? 'none' : '';
    });

    syncArthasSliderLockState();
}

function ensureArthasModeOption() {
    const modeRow = document.querySelector('.settings-container .display-mode-container .flex.items-center.mb-4')
        || document.querySelector('.display-mode-container .flex.items-center.mb-4')
        || document.querySelector('.display-mode-container > .flex.items-center');
    if (!modeRow) return;

    if (!modeRow.querySelector('.arthasmod-theme-option')) {
        modeRow.appendChild(buildArthasModeOption());
    }

    syncArthasModeOptionState();
}

function handleThemeModeSelectionEvent(event) {
    if (suppressThemeSelectionHandling) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const displayModeInput = target.closest('input[name="settingsDisplayMode"]');
    if (displayModeInput) {
        const wantsArthas = displayModeInput.id === 'settingsArthasMode';
        setArthasModeEnabled(wantsArthas, true);
        return;
    }

    const displayModeLabel = target.closest('label[for]');
    if (displayModeLabel) {
        const forId = displayModeLabel.getAttribute('for');
        const linkedInput = forId ? document.getElementById(forId) : null;
        if (linkedInput?.name === 'settingsDisplayMode') {
            const wantsArthas = linkedInput.id === 'settingsArthasMode';
            setArthasModeEnabled(wantsArthas, true);
            return;
        }
    }

    if (target.matches('.display-mode-container .range-slider') || target.closest('.display-mode-container .range-slider')) {
        if (isArthasModeEnabled()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const slider = target.closest('.display-mode-container .range-slider') || target;
            if (slider && typeof slider.value !== 'undefined') {
                setArthasLessonBrightnessFromSlider(slider);
            }
        }
        return;
    }
}

function startArthasModeOptionObserver() {
    ensureArthasModeOption();
    ensureUpdateControl();
    decorateFooter();

    document.addEventListener('click', handleThemeModeSelectionEvent, true);
    document.addEventListener('change', handleThemeModeSelectionEvent, true);
    document.addEventListener('input', handleThemeModeSelectionEvent, true);

    const modeObserver = new MutationObserver(() => {
        ensureArthasModeOption();
        ensureUpdateControl();
        decorateFooter();
    });

    if (document.body) {
        modeObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Fallback for views that reuse hidden DOM without mutation events.
    window.setInterval(() => {
        ensureArthasModeOption();
        ensureUpdateControl();
        decorateFooter();
        if (isArthasModeEnabled()) {
            setArthasLessonBrightnessFromSlider(getDisplayModeSlider());
        }
    }, 1000);
}

function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(response);
            });
        } catch (error) {
            reject(error);
        }
    });
}

function getDisplaySettingsContainer() {
    return document.querySelector('.settings-container .display-mode-container')
        || document.querySelector('.display-mode-container');
}

function setUpdateStatus(text, tone = 'muted') {
    const status = document.getElementById(UPDATE_STATUS_ID);
    if (!status) return;
    status.textContent = text || '';
    status.dataset.tone = tone;
}

function toggleUpdateApplyButton(show) {
    const applyBtn = document.getElementById(UPDATE_APPLY_BUTTON_ID);
    if (!applyBtn) return;
    applyBtn.style.display = show ? '' : 'none';
    applyBtn.disabled = !show;
}

function buildUpdateControl() {
    const wrapper = document.createElement('div');
    wrapper.className = UPDATE_CONTAINER_CLASS;

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.id = UPDATE_BUTTON_ID;
    checkBtn.className = 'arthasmod-button';
    checkBtn.textContent = 'Check for updates';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.id = UPDATE_APPLY_BUTTON_ID;
    applyBtn.className = 'arthasmod-button ghost';
    applyBtn.textContent = 'Update now';
    applyBtn.style.display = 'none';

    const status = document.createElement('span');
    status.id = UPDATE_STATUS_ID;
    status.className = 'arthasmod-update-status';
    status.textContent = `Current version: v${EXTENSION_VERSION}`;

    wrapper.append(checkBtn, applyBtn, status);
    return wrapper;
}

async function handleApplyUpdateClick(options = {}) {
    const applyBtn = document.getElementById(UPDATE_APPLY_BUTTON_ID);
    if (applyBtn) applyBtn.disabled = true;
    if (!options.skipStatus) {
        setUpdateStatus('Requesting update…', 'muted');
    }

    try {
        const response = await sendRuntimeMessage({ action: 'APPLY_UPDATE' });
        const status = response?.status || '';

        if (status === 'update_available') {
            setUpdateStatus('Update downloaded. Reloading extension…', 'ok');
            window.setTimeout(() => {
                try {
                    chrome.runtime.reload();
                } catch {
                    window.location.reload();
                }
            }, 400);
        } else if (status === 'no_update') {
            setUpdateStatus('Already up to date. If you load unpacked, run start-isy.ps1 to pull latest.', 'warn');
            toggleUpdateApplyButton(false);
        } else if (status === 'throttled') {
            setUpdateStatus('Update server throttled—try again later.', 'warn');
        } else if (response?.ok) {
            setUpdateStatus('Update request sent.', 'ok');
        } else {
            throw new Error(response?.error || 'Update failed.');
        }
    } catch (error) {
        setUpdateStatus(error?.message || 'Update failed.', 'error');
    } finally {
        if (applyBtn) applyBtn.disabled = false;
    }
}

async function handleUpdateCheckClick() {
    const checkBtn = document.getElementById(UPDATE_BUTTON_ID);
    const applyBtn = document.getElementById(UPDATE_APPLY_BUTTON_ID);
    if (checkBtn) checkBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    setUpdateStatus('Checking for updates…', 'muted');

    try {
        const response = await sendRuntimeMessage({ action: 'CHECK_UPDATE' });
        if (!response?.ok) {
            throw new Error(response?.error || 'Update check failed.');
        }

        const { currentVersion, latestVersion, hasUpdate } = response;
        if (hasUpdate && latestVersion) {
            setUpdateStatus(`Update available: v${currentVersion} → v${latestVersion}. Applying…`, 'info');
            toggleUpdateApplyButton(true);
            await handleApplyUpdateClick({ skipStatus: true });
        } else {
            toggleUpdateApplyButton(false);
            setUpdateStatus('You are on the latest version.', 'ok');
        }
    } catch (error) {
        toggleUpdateApplyButton(false);
        setUpdateStatus(error?.message || 'Update check failed.', 'error');
    } finally {
        if (checkBtn) checkBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = false;
    }
}

function bindUpdateControlEvents(wrapper) {
    const checkBtn = wrapper.querySelector(`#${UPDATE_BUTTON_ID}`);
    const applyBtn = wrapper.querySelector(`#${UPDATE_APPLY_BUTTON_ID}`);

    if (checkBtn && !checkBtn.dataset.arthasBound) {
        checkBtn.dataset.arthasBound = '1';
        checkBtn.addEventListener('click', handleUpdateCheckClick);
    }

    if (applyBtn && !applyBtn.dataset.arthasBound) {
        applyBtn.dataset.arthasBound = '1';
        applyBtn.addEventListener('click', () => handleApplyUpdateClick());
    }
}

function ensureUpdateControl() {
    const container = getDisplaySettingsContainer();
    if (!container) return;

    let control = container.querySelector(`.${UPDATE_CONTAINER_CLASS}`);
    if (!control) {
        control = buildUpdateControl();
        container.appendChild(control);
    }

    bindUpdateControlEvents(control);
}

const TIMETABLE_OVERLAY_SELECTOR = '#isy-cached-timetable';
const TIMETABLE_ENTRY_SELECTOR = '.calendar-week-element-inner';
const TIMETABLE_SCOPE_SELECTOR = '.time-table-scaffold, .calendar-wrapper[data-view-type="week"], .day-view-scaffold';
const TIMETABLE_STRUCTURE_SELECTOR = `${TIMETABLE_SCOPE_SELECTOR}, .day-container, .day-header-container, .day-all-container, .tts-header, .current-week-button`;
const TIMETABLE_MUTATION_TARGET_SELECTOR = `${TIMETABLE_ENTRY_SELECTOR}, .calendar-week-element, ${TIMETABLE_STRUCTURE_SELECTOR}`;

function isInsideCachedTimetableOverlay(element) {
    return Boolean(element?.closest?.(TIMETABLE_OVERLAY_SELECTOR));
}

function collectTimetableEntriesFromNode(node, targetSet) {
    if (!(node instanceof Element)) return;

    if (node.matches(TIMETABLE_ENTRY_SELECTOR) && !isInsideCachedTimetableOverlay(node)) {
        targetSet.add(node);
    }

    node.querySelectorAll?.(TIMETABLE_ENTRY_SELECTOR).forEach((entry) => {
        if (!isInsideCachedTimetableOverlay(entry)) {
            targetSet.add(entry);
        }
    });
}

function collectTimetableMutationInfo(mutations) {
    const entrySet = new Set();
    let touchesTimetable = false;
    let hasStructureChange = false;

    for (const mutation of mutations) {
        if (!mutation) continue;

        const targetElement = mutation.target instanceof Element
            ? mutation.target
            : mutation.target?.parentElement || null;

        if (targetElement?.closest?.(TIMETABLE_SCOPE_SELECTOR) || targetElement?.matches?.(TIMETABLE_MUTATION_TARGET_SELECTOR)) {
            touchesTimetable = true;
        }

        if (mutation.type !== 'childList') continue;

        mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;

            collectTimetableEntriesFromNode(node, entrySet);

            if (
                node.matches(TIMETABLE_STRUCTURE_SELECTOR)
                || Boolean(node.querySelector?.(TIMETABLE_STRUCTURE_SELECTOR))
            ) {
                touchesTimetable = true;
                hasStructureChange = true;
            }
        });

        if (mutation.removedNodes.length > 0 && targetElement?.closest?.(TIMETABLE_SCOPE_SELECTOR)) {
            touchesTimetable = true;
            hasStructureChange = true;
        }
    }

    return {
        entries: Array.from(entrySet),
        touchesTimetable,
        hasStructureChange
    };
}

function getRealTimetableScaffold() {
    return Array.from(document.querySelectorAll('.time-table-scaffold'))
        .find((el) => !isInsideCachedTimetableOverlay(el)) || null;
}

function getWeekKeyFromScaffold(scaffold) {
    if (!scaffold) return null;

    const headerColumns = Array.from(scaffold.querySelectorAll(
        '.day-header-container .calendar-week-day, .day-header-container .calendar-week-day-header, .day-header-container .cwd-header-label'
    ));
    const dates = headerColumns
        .map((column) => parseHeaderDate(column.textContent || ''))
        .filter(Boolean);

    return getWeekKeyFromDates(dates);
}

function getWeekKeyFromUrl(url = window.location.href) {
    const match = url.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;

    return formatDateAsWeekKey(getStartOfIsoWeek(date));
}

function getOverlayWeekKey() {
    return getWeekKeyFromUrl() || getCurrentWeekKey();
}

function readTimetableCacheStore() {
    const fallback = { weeks: {} };

    const raw = localStorage.getItem(TIMETABLE_CACHE_STORE_KEY);
    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return fallback;
        if (!parsed.weeks || typeof parsed.weeks !== 'object') return fallback;
        return { weeks: parsed.weeks };
    } catch {
        return fallback;
    }
}

function pruneTimetableCache(store) {
    const now = Date.now();
    const entries = Object.entries(store.weeks || {})
        .filter(([, entry]) => (
            entry
            && typeof entry.html === 'string'
            && typeof entry.savedAt === 'number'
            && (now - entry.savedAt) < MAX_CACHE_AGE_MS
        ))
        .sort((a, b) => b[1].savedAt - a[1].savedAt)
        .slice(0, 16);

    store.weeks = Object.fromEntries(entries);
    return store;
}

function writeTimetableCacheStore(store) {
    try {
        localStorage.setItem(TIMETABLE_CACHE_STORE_KEY, JSON.stringify(pruneTimetableCache(store)));
        return true;
    } catch (error) {
        console.warn('Isy Modernizer: Could not persist timetable cache.', error);
        return false;
    }
}

function getCachedWeekHtml(weekKey) {
    const store = pruneTimetableCache(readTimetableCacheStore());
    const cachedEntry = store.weeks?.[weekKey];
    if (cachedEntry && typeof cachedEntry.html === 'string') {
        return cachedEntry.html;
    }

    if (weekKey !== getCurrentWeekKey()) return null;

    const legacyHtml = localStorage.getItem(LEGACY_CACHE_KEY);
    const legacyTimestamp = Number.parseInt(localStorage.getItem(LEGACY_CACHE_TIMESTAMP_KEY) || '', 10);
    if (!legacyHtml || !Number.isFinite(legacyTimestamp)) return null;
    if ((Date.now() - legacyTimestamp) >= MAX_CACHE_AGE_MS) return null;

    return legacyHtml;
}

function createCachedOverlayElement(weekKey, html) {
    const overlay = document.createElement('div');
    overlay.id = 'isy-cached-timetable';
    overlay.dataset.weekKey = weekKey;
    overlay.style.position = 'fixed';
    overlay.style.top = '64px';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = 'calc(100vh - 64px)';
    overlay.style.zIndex = '99999';
    overlay.style.pointerEvents = 'none';
    overlay.style.opacity = '1.0';
    overlay.style.backgroundColor = 'var(--isy-bg-gradient, #1a1b1a)';
    overlay.style.filter = 'grayscale(0.2)';
    overlay.style.overflow = 'hidden';
    overlay.innerHTML = html;
    overlay.querySelectorAll('.tts-header, .day-header-container, .week-header-row, .time-strip-toggle-container')
        .forEach((el) => el.remove());
    return overlay;
}

function renderCachedWeekOverlay(weekKey, html) {
    if (!html || !weekKey) return false;

    const existing = document.getElementById('isy-cached-timetable');
    if (existing) {
        existing.replaceWith(createCachedOverlayElement(weekKey, html));
    } else {
        document.body.appendChild(createCachedOverlayElement(weekKey, html));
    }

    return true;
}

function showCachedWeekOverlay(weekKey) {
    if (!shouldShowTimetableOverlay()) return false;
    if (!weekKey) return false;

    const html = getCachedWeekHtml(weekKey);
    if (!html) return false;

    return renderCachedWeekOverlay(weekKey, html);
}

function createCacheHtmlFromScaffold(scaffold) {
    const clone = scaffold.cloneNode(true);
    const existingOverlay = clone.querySelector('#isy-cached-timetable');
    if (existingOverlay) existingOverlay.remove();

    clone.querySelectorAll('.tts-header, .day-header-container, .week-header-row, .time-strip-toggle-container')
        .forEach((el) => el.remove());

    return clone.innerHTML;
}

function saveScaffoldToWeekCache(scaffold, explicitWeekKey = null) {
    if (!scaffold) return null;

    const weekKey = explicitWeekKey || getWeekKeyFromScaffold(scaffold);
    if (!weekKey) return null;

    const html = createCacheHtmlFromScaffold(scaffold);
    if (!html) return null;

    const store = readTimetableCacheStore();
    if (!store.weeks || typeof store.weeks !== 'object') {
        store.weeks = {};
    }
    store.weeks[weekKey] = { html, savedAt: Date.now() };
    writeTimetableCacheStore(store);

    if (weekKey === getCurrentWeekKey()) {
        try {
            localStorage.setItem(LEGACY_CACHE_KEY, html);
            localStorage.setItem(LEGACY_CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch {
            // ignore storage fallback errors
        }
    }

    return weekKey;
}

function waitForWeekKeyChange(previousWeekKey, timeoutMs = 15000) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const check = () => {
            if (!shouldShowTimetableOverlay()) {
                reject(new Error('Not on timetable view anymore.'));
                return;
            }

            const scaffold = getRealTimetableScaffold();
            const weekKey = getWeekKeyFromScaffold(scaffold);
            if (scaffold && weekKey && weekKey !== previousWeekKey) {
                resolve({ scaffold, weekKey });
                return;
            }

            if ((Date.now() - startedAt) >= timeoutMs) {
                reject(new Error('Timed out waiting for a week change.'));
                return;
            }

            window.setTimeout(check, 120);
        };

        check();
    });
}

function waitForWeekKey(targetWeekKey, timeoutMs = 15000) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const check = () => {
            if (!shouldShowTimetableOverlay()) {
                reject(new Error('Not on timetable view anymore.'));
                return;
            }

            const scaffold = getRealTimetableScaffold();
            const weekKey = getWeekKeyFromScaffold(scaffold);
            if (scaffold && weekKey && weekKey === targetWeekKey) {
                resolve({ scaffold, weekKey });
                return;
            }

            if ((Date.now() - startedAt) >= timeoutMs) {
                reject(new Error(`Timed out waiting for week ${targetWeekKey}.`));
                return;
            }

            window.setTimeout(check, 120);
        };

        check();
    });
}

function getClickableAncestor(element) {
    if (!element) return null;
    return element.closest('button, a, [role="button"], .cursor-pointer') || element;
}

function triggerElementClick(element) {
    const clickable = getClickableAncestor(element);
    if (!clickable) return false;

    clickable.click();
    return true;
}

function getTimetableCurrentWeekButton() {
    const scaffold = getRealTimetableScaffold();
    if (!scaffold) return null;
    return getClickableAncestor(scaffold.querySelector('.tts-header .current-week-button'));
}

function getTimetableNavigationButton(direction) {
    const iconName = direction === 'previous' ? 'chevron-left' : 'chevron-right';
    const scaffold = getRealTimetableScaffold();
    if (!scaffold) return null;

    const header = scaffold.querySelector('.tts-header');
    if (!header) return null;

    const icon = header.querySelector(`svg[data-icon="${iconName}"], i.fa-${iconName}, .fa-${iconName}`);
    return getClickableAncestor(icon);
}

function getDisplayedWeekKeyForNavigation() {
    const overlayWeekKey = document.getElementById('isy-cached-timetable')?.dataset?.weekKey;
    if (overlayWeekKey) return overlayWeekKey;

    const realWeekKey = getWeekKeyFromScaffold(getRealTimetableScaffold());
    return realWeekKey || getCurrentWeekKey();
}

function handleTimetableNavigationOverlay(direction) {
    if (!shouldShowTimetableOverlay()) return;

    const baseWeekKey = getDisplayedWeekKeyForNavigation();
    if (!baseWeekKey) return;

    let targetWeekKey = baseWeekKey;
    if (direction === 'previous') {
        targetWeekKey = addWeeksToWeekKey(baseWeekKey, -1) || targetWeekKey;
    } else if (direction === 'next') {
        targetWeekKey = addWeeksToWeekKey(baseWeekKey, 1) || targetWeekKey;
    } else if (direction === 'current') {
        targetWeekKey = getCurrentWeekKey();
    }

    showCachedWeekOverlay(targetWeekKey);
}

function ensureTimetableNavigationOverlayHandlers() {
    const previousButton = getTimetableNavigationButton('previous');
    const nextButton = getTimetableNavigationButton('next');
    const currentButton = getTimetableCurrentWeekButton();

    if (previousButton && !previousButton.dataset.arthasOverlayNavBound) {
        previousButton.dataset.arthasOverlayNavBound = '1';
        previousButton.addEventListener('click', () => {
            handleTimetableNavigationOverlay('previous');
        }, true);
    }

    if (nextButton && !nextButton.dataset.arthasOverlayNavBound) {
        nextButton.dataset.arthasOverlayNavBound = '1';
        nextButton.addEventListener('click', () => {
            handleTimetableNavigationOverlay('next');
        }, true);
    }

    if (currentButton && !currentButton.dataset.arthasOverlayNavBound) {
        currentButton.dataset.arthasOverlayNavBound = '1';
        currentButton.addEventListener('click', () => {
            handleTimetableNavigationOverlay('current');
        }, true);
    }
}

async function clickAndCacheWeek(button, mode = 'change', targetWeekKey = null) {
    if (!button) return getWeekKeyFromScaffold(getRealTimetableScaffold());

    const previousWeekKey = getWeekKeyFromScaffold(getRealTimetableScaffold());
    if (!triggerElementClick(button)) return previousWeekKey;

    try {
        const result = (mode === 'target' && targetWeekKey)
            ? await waitForWeekKey(targetWeekKey)
            : await waitForWeekKeyChange(previousWeekKey);

        if (result?.scaffold) {
            saveScaffoldToWeekCache(result.scaffold, result.weekKey);
        }

        return result?.weekKey || previousWeekKey;
    } catch {
        const scaffold = getRealTimetableScaffold();
        const weekKey = getWeekKeyFromScaffold(scaffold);
        if (scaffold && weekKey) {
            saveScaffoldToWeekCache(scaffold, weekKey);
        }
        return weekKey || previousWeekKey;
    }
}

function getWeekDelta(fromWeekKey, toWeekKey) {
    const fromDate = parseWeekKey(fromWeekKey);
    const toDate = parseWeekKey(toWeekKey);
    if (!fromDate || !toDate) return null;

    const fromUtc = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const toUtc = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    const deltaDays = Math.round((toUtc - fromUtc) / 86400000);
    if (!Number.isFinite(deltaDays)) return null;

    return Math.trunc(deltaDays / 7);
}

async function navigateTimetableToWeek(targetWeekKey, displayedWeekKey = null) {
    if (!targetWeekKey) return displayedWeekKey;

    let currentWeekKey = displayedWeekKey || getWeekKeyFromScaffold(getRealTimetableScaffold());
    if (!currentWeekKey) return currentWeekKey;

    let steps = 0;
    while (currentWeekKey && currentWeekKey !== targetWeekKey && steps < 30) {
        if (!shouldShowTimetableOverlay()) return currentWeekKey;

        const weekDelta = getWeekDelta(currentWeekKey, targetWeekKey);
        const direction = weekDelta === null
            ? (targetWeekKey < currentWeekKey ? 'previous' : 'next')
            : (weekDelta < 0 ? 'previous' : 'next');

        const nextWeekKey = await clickAndCacheWeek(getTimetableNavigationButton(direction));
        if (!nextWeekKey || nextWeekKey === currentWeekKey) break;

        currentWeekKey = nextWeekKey;
        steps += 1;
    }

    return currentWeekKey;
}

async function preloadNeighborWeeksInBackground(anchorWeekKey = null) {
    if (!shouldShowTimetableOverlay()) return;

    const initialScaffold = getRealTimetableScaffold();
    if (!initialScaffold) return;

    saveScaffoldToWeekCache(initialScaffold);

    let displayedWeekKey = getWeekKeyFromScaffold(initialScaffold);
    const targetAnchorWeekKey = anchorWeekKey || displayedWeekKey;
    if (!targetAnchorWeekKey) return;

    displayedWeekKey = await navigateTimetableToWeek(targetAnchorWeekKey, displayedWeekKey);

    for (let i = 0; i < PRELOAD_PREVIOUS_WEEKS; i += 1) {
        if (!shouldShowTimetableOverlay()) return;

        const nextWeekKey = await clickAndCacheWeek(getTimetableNavigationButton('previous'));
        if (!nextWeekKey || nextWeekKey === displayedWeekKey) break;

        displayedWeekKey = nextWeekKey;
    }

    displayedWeekKey = await navigateTimetableToWeek(targetAnchorWeekKey, displayedWeekKey);

    for (let i = 0; i < PRELOAD_NEXT_WEEKS; i += 1) {
        if (!shouldShowTimetableOverlay()) return;

        const nextWeekKey = await clickAndCacheWeek(getTimetableNavigationButton('next'));
        if (!nextWeekKey || nextWeekKey === displayedWeekKey) break;

        displayedWeekKey = nextWeekKey;
    }

    await navigateTimetableToWeek(targetAnchorWeekKey, displayedWeekKey);
}

function startBackgroundWeekPreloadIfReady() {
    if (timetablePreloadPromise) return;
    if (!shouldShowTimetableOverlay()) return;

    const scaffold = getRealTimetableScaffold();
    if (!scaffold) return;

    const anchorWeekKey = getWeekKeyFromScaffold(scaffold);
    if (!anchorWeekKey) return;
    if (anchorWeekKey === activePreloadAnchorWeekKey) return;
    if (anchorWeekKey === lastPreloadedAnchorWeekKey) return;

    if (!getTimetableNavigationButton('previous')) return;
    if (!getTimetableNavigationButton('next')) return;

    activePreloadAnchorWeekKey = anchorWeekKey;
    timetablePreloadPromise = preloadNeighborWeeksInBackground(anchorWeekKey)
        .then(() => {
            lastPreloadedAnchorWeekKey = anchorWeekKey;
        })
        .catch((error) => {
            console.warn('Isy Modernizer: Week preloading failed.', error);
        })
        .finally(() => {
            timetablePreloadPromise = null;
            activePreloadAnchorWeekKey = null;

            // If user moved weeks while preload was running, start another preload for the latest week.
            window.setTimeout(() => {
                startBackgroundWeekPreloadIfReady();
            }, 0);
        });
}

function applyCachedTimetable() {
    if (!isArthasModeEnabled()) return;

    console.log("Isy Modernizer: Checking cache for timetable...");
    // Only run on the main timetable view
    if (!shouldShowTimetableOverlay()) return;
    // Avoid showing cached overlay on non-timetable page shells during SPA transitions.
    if (!hasRealTimetableScaffoldOrMount()) return;

    // Avoid double overlay
    if (document.getElementById('isy-cached-timetable')) return;

    // Don't show cache if real content is already here
    // Exclude our own overlay from this check.
    const allItems = document.querySelectorAll(TIMETABLE_ENTRY_SELECTOR);
    for (const item of allItems) {
        if (!isInsideCachedTimetableOverlay(item)) {
            console.log("Isy Modernizer: Real content already present, skipping cache.");
            return;
        }
    }

    const overlayWeekKey = getOverlayWeekKey();
    const cachedHTML = getCachedWeekHtml(overlayWeekKey);

    if (cachedHTML && renderCachedWeekOverlay(overlayWeekKey, cachedHTML)) {
        console.log(`Isy Modernizer: Cached timetable applied for week ${overlayWeekKey}.`);
    }
}

// Global state to track URL (path + query + hash for SPA routes)
let currentUrl = window.location.href;
let timetableObserverStarted = false;
let arthasModeObserverStarted = false;

function startTimetableObserver() {
    if (timetableObserverStarted) return;
    timetableObserverStarted = true;
    ensureTimetableNavigationOverlayHandlers();
    let lastOverlayAttemptAt = 0;
    let mutationDebounceTimeout = null;
    let saveCacheTimeout = null;
    const pendingMutations = [];

    const processTimetableMutation = (mutations = []) => {
        if (!isArthasModeEnabled()) {
            removeCachedTimetableOverlay();
            return;
        }

        const mutationInfo = collectTimetableMutationInfo(mutations);
        const urlChanged = window.location.href !== currentUrl;
        if (urlChanged) {
            currentUrl = window.location.href;
            console.log("Isy Modernizer: Navigated to", currentUrl);
        }

        decorateFooter();

        const overlay = document.getElementById('isy-cached-timetable');
        let hasOverlay = Boolean(overlay);
        const canShowOverlay = shouldShowTimetableOverlay();

        // Safety: if we are no longer on a view where cache should appear, remove immediately.
        if (overlay && !canShowOverlay) {
            removeCachedTimetableOverlay();
            hasOverlay = false;
        }

        // 1. Detect SPA Navigation
        if (urlChanged) {
            if (canShowOverlay) {
                applyCachedTimetable();
            } else {
                // If we left timetable, remove overlay immediately
                removeCachedTimetableOverlay();
            }
        }

        const needsTimetableChecks = canShowOverlay || hasOverlay;
        if (!needsTimetableChecks) return;

        if (
            !urlChanged
            && !hasOverlay
            && !mutationInfo.touchesTimetable
            && mutationInfo.entries.length === 0
            && !mutationInfo.hasStructureChange
        ) {
            return;
        }

        const shouldRunFullScan = urlChanged
            || mutationInfo.hasStructureChange
            || (mutationInfo.touchesTimetable && mutationInfo.entries.length === 0);

        let realItems = [];
        let realScaffold = null;

        if (shouldRunFullScan) {
            realItems = Array.from(document.querySelectorAll(TIMETABLE_ENTRY_SELECTOR))
                .filter((el) => !isInsideCachedTimetableOverlay(el));
            realScaffold = getRealTimetableScaffold();
        } else {
            realItems = mutationInfo.entries;
            if (hasOverlay || mutationInfo.touchesTimetable) {
                realScaffold = getRealTimetableScaffold();
            }
        }

        // When re-opening the site, the first cache attempt can happen before the timetable mount exists.
        // Retry once the timetable shell appears, before the network data arrives.
        if (shouldRunFullScan && !hasOverlay && canShowOverlay && hasRealTimetableScaffoldOrMount() && realItems.length === 0) {
            const now = Date.now();
            if ((now - lastOverlayAttemptAt) > 300) {
                lastOverlayAttemptAt = now;
                try {
                    applyCachedTimetable();
                } catch (error) {
                    console.warn('Isy Modernizer: applyCachedTimetable failed during scaffold retry.', error);
                }
            }
        }

        // Remove the overlay only when the real scaffold matches the overlay week.
        // This keeps cached content visible during week switches and offline mode.
        if (hasOverlay && realScaffold) {
            const currentOverlay = document.getElementById('isy-cached-timetable');
            const overlayWeekKey = currentOverlay?.dataset?.weekKey || null;
            const realWeekKey = getWeekKeyFromScaffold(realScaffold);
            if (!overlayWeekKey || !realWeekKey || overlayWeekKey === realWeekKey) {
                removeCachedTimetableOverlay();
            }
        }

        if (realItems.length > 0) {
            applyTimetableClasses(realItems);
        }

        // 3. Update Cache (Debounced)
        if (realScaffold && canShowOverlay) {
            ensureTimetableNavigationOverlayHandlers();

            if (!saveCacheTimeout) {
                saveCacheTimeout = window.setTimeout(() => {
                    const scaffold = getRealTimetableScaffold();
                    if (scaffold) {
                        const weekKey = saveScaffoldToWeekCache(scaffold);
                        if (weekKey) {
                            console.log(`Isy Modernizer: Timetable cache updated for week ${weekKey}.`);
                        }
                    }
                    saveCacheTimeout = null;
                }, 900);
            }

            startBackgroundWeekPreloadIfReady();
        }
    };

    const scheduleMutationProcessing = () => {
        if (mutationDebounceTimeout) return;
        mutationDebounceTimeout = window.setTimeout(() => {
            mutationDebounceTimeout = null;
            const batchedMutations = pendingMutations.splice(0, pendingMutations.length);
            processTimetableMutation(batchedMutations);
        }, 90);
    };

    const observer = new MutationObserver((mutations) => {
        if (mutations.length > 0) {
            pendingMutations.push(...mutations);
        }
        scheduleMutationProcessing();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // URL watchdog: some SPA transitions don't trigger a useful mutation immediately.
    window.setInterval(() => {
        if (!isArthasModeEnabled()) {
            removeCachedTimetableOverlay();
            return;
        }

        if (window.location.href !== currentUrl) {
            scheduleMutationProcessing();
            return;
        }

        if (!shouldShowTimetableOverlay()) {
            removeCachedTimetableOverlay();
        }
    }, 1000);
}

function initializeArthasFeatures() {
    if (!isArthasModeEnabled()) return;

    try {
        decorateFooter();
        syncArthasVersionLabels();
        applyCachedTimetable();
        startTimetableObserver();

        // Defer initial timetable decoration until after current render tick.
        window.setTimeout(() => {
            if (!isArthasModeEnabled()) return;
            applyTimetableClasses(Array.from(document.querySelectorAll(TIMETABLE_ENTRY_SELECTOR)));
        }, 0);

        ensureTimetablePastRefresh();
        chrome.runtime.sendMessage({ action: 'SYNC_THEME' });
    } catch (error) {
        console.warn('Isy Modernizer: initializeArthasFeatures failed.', error);
    }
}

async function initializeThemeMode() {
    const localMode = readThemeModePreferenceFromLocalStorage();
    const storedMode = await readThemeModePreferenceFromStorage();

    // Prefer the most recently written local value; fall back to extension storage.
    const resolvedMode = localMode ?? storedMode ?? ARTHAS_THEME_MODE.ISY;

    applyArthasModeStateToDom(resolvedMode === ARTHAS_THEME_MODE.ARTHAS);

    // Keep both storage locations in sync with the resolved choice.
    if (storedMode !== resolvedMode || localMode !== resolvedMode) {
        writeThemeModePreference(resolvedMode);
    }
}

function bootstrapArthasMod() {
    ensureBaseAbsenceTableFixStyles();
    ensureBaseUiStyles();
    ensureArthasLessonBrightnessStyle();
    decorateFooter();

    if (!arthasModeObserverStarted) {
        arthasModeObserverStarted = true;
        startArthasModeOptionObserver();
    }

    if (isArthasModeEnabled()) {
        initializeArthasFeatures();
    }
}

// Initialize
async function startArthasMod() {
    await initializeThemeMode();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapArthasMod);
    } else {
        bootstrapArthasMod();
    }
}

startArthasMod();
