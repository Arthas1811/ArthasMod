const GITHUB_RELEASES_LATEST_URL = 'https://api.github.com/repos/Arthas1811/ArthasMod/releases/latest';
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

function normalizeVersion(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.replace(/^v/i, '');
}

async function fetchLatestVersion() {
    // Prefer GitHub releases (tags), fall back to manifest.json in main.
    try {
        const releaseResponse = await fetch(GITHUB_RELEASES_LATEST_URL, { cache: 'no-store' });
        if (releaseResponse.ok) {
            const data = await releaseResponse.json();
            const versionFromTag = normalizeVersion(data?.tag_name || data?.name);
            if (versionFromTag) {
                return {
                    version: versionFromTag,
                    source: 'github-release',
                    url: data?.html_url || null
                };
            }
        }
    } catch {
        // Ignore and try manifest.
    }

    const manifestResponse = await fetch(GITHUB_MANIFEST_URL, { cache: 'no-store' });
    if (!manifestResponse.ok) {
        throw new Error(`GitHub responded ${manifestResponse.status}`);
    }
    const manifest = await manifestResponse.json();
    const versionFromManifest = normalizeVersion(manifest?.version);
    return {
        version: versionFromManifest || null,
        source: 'manifest',
        url: GITHUB_MANIFEST_URL
    };
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
                const latest = await fetchLatestVersion();
                const latestVersion = latest?.version || null;
                const hasUpdate = latestVersion ? compareSemver(latestVersion, CURRENT_VERSION) > 0 : false;
                sendResponse({
                    ok: true,
                    currentVersion: CURRENT_VERSION,
                    latestVersion,
                    hasUpdate,
                    source: latest?.source || 'unknown',
                    releaseUrl: latest?.url || null
                });
            } catch (error) {
                sendResponse({ ok: false, error: error?.message || 'Update check failed.' });
            }
        })();
        return true;
    }

    if (r.action === 'APPLY_UPDATE') {
        (async () => {
            try {
                const latest = await fetchLatestVersion();
                const latestVersion = latest?.version || null;
                if (!latestVersion || compareSemver(latestVersion, CURRENT_VERSION) <= 0) {
                    sendResponse({
                        ok: true,
                        status: 'no_update',
                        latestVersion,
                        currentVersion: CURRENT_VERSION
                    });
                    return;
                }

                chrome.runtime.requestUpdateCheck((status, details) => {
                    if (status === 'update_available') {
                        // Chrome will download the update package; reload to apply once ready.
                        chrome.runtime.reload();
                        sendResponse({ ok: true, status, details, latestVersion });
                    } else {
                        sendResponse({ ok: true, status, details, latestVersion });
                    }
                });
            } catch (error) {
                sendResponse({ ok: false, error: error?.message || 'Update apply failed.' });
            }
        })();
        return true;
    }
});
