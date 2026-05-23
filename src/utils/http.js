import { log } from 'apify';
import { gotScraping } from 'got-scraping';

const DEFAULT_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
};

/**
 * Fetch JSON from a URL with retries and stealth headers.
 */
export async function fetchJson(url, { headers = {}, proxyUrl, retries = 3, method = 'GET', body } = {}) {
    const waitFor = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const opts = {
                url,
                method,
                headers: { ...DEFAULT_HEADERS, ...headers },
                responseType: 'json',
                throwHttpErrors: true,
                timeout: { request: 30_000 },
            };
            if (proxyUrl) opts.proxyUrl = proxyUrl;
            if (body) {
                opts.body = typeof body === 'string' ? body : JSON.stringify(body);
                opts.headers['Content-Type'] = 'application/json';
            }
            const res = await gotScraping(opts);
            return res.body;
        } catch (err) {
            if (attempt === retries) throw err;
            const wait = attempt * 2000;
            log.warning(`HTTP ${method} ${url} failed (attempt ${attempt}/${retries}): ${err.message} — retrying in ${wait}ms`);
            await waitFor(wait);
        }
    }

    throw new Error(`HTTP ${method} ${url} failed after ${retries} attempts`);
}

/** Remove all null/undefined values from an object (shallow). */
export function cleanObj(obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );
}

/** Parse an ISO date string to YYYY-MM-DD, or return null. */
export function parseDate(val) {
    if (!val) return null;
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    } catch { return null; }
}
