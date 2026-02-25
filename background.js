const GITHUB_MANIFEST_URL = 'https://raw.githubusercontent.com/Arthas1811/ArthasMod/main/manifest.json';
const CURRENT_VERSION = chrome.runtime.getManifest().version;

function compareSemver(a, b) {
    const toParts = (v) => (v || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
    const aParts = toParts(a);
    const bParts = toParts(b);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i += 1) {
        const aVal = aParts[i] ?? 0;
        const bVal = bParts[i] ?? 0;
        if (aVal > bVal) return 1;
        if (aVal < bVal) return -1;
    }
    return 0;
}

async function fetchLatestVersion() {
    const response = await fetch(GITHUB_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`GitHub responded ${response.status}`);
    }
    const data = await response.json();
    return data?.version || null;
}

chrome.runtime.onMessage.addListener((r, s, sendResponse) => {
    if (r.action === 'SYNC_THEME') {
        chrome.cookies.get({ url: 'https://isy-api.ksr.ch', name: 'token' }, (c) => {
            if (c) {
                console.log(`Isy Sync token: ${c.value}`);
            }
        });
        return;
    }

    if (r.action === 'CHECK_UPDATE') {
        (async () => {
            try {
                const latestVersion = await fetchLatestVersion();
                const hasUpdate = latestVersion ? compareSemver(latestVersion, CURRENT_VERSION) > 0 : false;
                sendResponse({
                    ok: true,
                    currentVersion: CURRENT_VERSION,
                    latestVersion,
                    hasUpdate,
                    source: 'github'
                });
            } catch (error) {
                sendResponse({ ok: false, error: error?.message || 'Update check failed.' });
            }
        })();
        return true;
    }

    if (r.action === 'APPLY_UPDATE') {
        try {
            chrome.runtime.requestUpdateCheck((status, details) => {
                if (status === 'update_available') {
                    // Chrome will download the update package; reload to apply once ready.
                    chrome.runtime.reload();
                    sendResponse({ ok: true, status, details });
                } else {
                    sendResponse({ ok: true, status, details });
                }
            });
        } catch (error) {
            sendResponse({ ok: false, error: error?.message || 'Update apply failed.' });
        }
        return true;
    }
});
