import { log } from 'apify';
import { Impit } from 'impit';

let defaultClient = new Impit({
  browser: 'chrome',
  ignoreTlsErrors: true,
});

function getClient(proxyUrl) {
  if (!proxyUrl) return defaultClient;
  return new Impit({
    browser: 'chrome',
    ignoreTlsErrors: true,
    proxyUrl,
  });
}

function refreshDefault() {
  defaultClient = new Impit({ browser: 'chrome', ignoreTlsErrors: true });
}

function jitter(min, max) {
  return min + Math.random() * (max - min);
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function isStreamError(err) {
  return err?.message?.includes('Error reading response stream')
    || err?.message?.includes('Decode')
    || err?.message?.includes('Body')
    || err?.message?.includes('TimedOut');
}

function buildReqHeaders({ origin, referer, xml }) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (referer) headers.referer = referer;
  if (xml) headers.accept = 'application/xml, text/xml;q=0.9, */*;q=0.8';
  return headers;
}

export async function fetchJson(url, { headers = {}, proxyUrl, retries = 3, method = 'GET', body, origin, referer } = {}) {
  const reqHeaders = { ...buildReqHeaders({ origin, referer }), ...headers };
  if (body) reqHeaders['content-type'] = 'application/json;charset=UTF-8';

  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = getClient(proxyUrl);
    const fetchOpts = { method, headers: reqHeaders, timeout: 90000 };
    if (body) fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);

    try {
      const response = await client.fetch(url, fetchOpts);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`HTTP ${response.status} for ${method} ${url}`);
        err.statusCode = response.status;
        err.body = text;
        throw err;
      }
      return await response.json();
    } catch (err) {
      const statusCode = err.statusCode || 0;
      const isRateLimit = statusCode === 429;
      const isServerError = statusCode >= 500;
      const isStreamErr = isStreamError(err);

      if (attempt === retries) throw err;

      // Refresh the default client on stream errors to avoid connection reuse issues
      if (isStreamErr && !proxyUrl) refreshDefault();

      let wait;
      if (isRateLimit) {
        wait = jitter(4000, 8000);
        log.warning(`HTTP 429 on ${method} ${url} — backing off ${Math.round(wait)}ms (attempt ${attempt}/${retries})`);
      } else if (isServerError) {
        wait = jitter(3000, 5000);
        log.warning(`HTTP ${statusCode} on ${method} ${url} — retrying in ${Math.round(wait)}ms (attempt ${attempt}/${retries})`);
      } else {
        wait = jitter(1500, 3500);
        log.warning(`HTTP ${method} ${url} failed (attempt ${attempt}/${retries}): ${err.message} — retrying in ${Math.round(wait)}ms`);
      }
      await delay(wait);
    }
  }

  throw new Error(`HTTP ${method} ${url} failed after ${retries} attempts`);
}

export async function fetchHtml(url, { headers = {}, proxyUrl, retries = 3, origin, referer } = {}) {
  const reqHeaders = { ...buildReqHeaders({ origin, referer }), ...headers };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = getClient(proxyUrl);
    try {
      const response = await client.fetch(url, { headers: reqHeaders, timeout: 90000 });
      const body = await response.text();
      return { statusCode: response.status, body, headers: response.headers };
    } catch (err) {
      if (attempt === retries) throw err;
      if (isStreamError(err) && !proxyUrl) refreshDefault();
      const wait = jitter(1500, 3500);
      log.warning(`fetchHtml ${url} failed (attempt ${attempt}/${retries}): ${err.message} — retrying in ${Math.round(wait)}ms`);
      await delay(wait);
    }
  }

  throw new Error(`fetchHtml ${url} failed after ${retries} attempts`);
}

export async function fetchXml(url, { headers = {}, proxyUrl, retries = 3, origin, referer } = {}) {
  const reqHeaders = { ...buildReqHeaders({ origin, referer, xml: true }), ...headers };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = getClient(proxyUrl);
    try {
      const response = await client.fetch(url, { headers: reqHeaders, timeout: 90000 });
      const body = await response.text();
      return { statusCode: response.status, body, headers: response.headers };
    } catch (err) {
      if (attempt === retries) throw err;
      if (isStreamError(err) && !proxyUrl) refreshDefault();
      const wait = jitter(1500, 3500);
      log.warning(`fetchXml ${url} failed (attempt ${attempt}/${retries}): ${err.message} — retrying in ${Math.round(wait)}ms`);
      await delay(wait);
    }
  }

  throw new Error(`fetchXml ${url} failed after ${retries} attempts`);
}

export function cleanObj(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
}

export function parseDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch { return null; }
}
