import { log } from 'apify';
import { Impit } from 'impit';

let defaultClient = new Impit({
  browser: 'chrome',
});

const proxyClients = new Map();

function getClient(proxyUrl) {
  if (!proxyUrl) return defaultClient;
  if (!proxyClients.has(proxyUrl)) {
    proxyClients.set(proxyUrl, new Impit({ browser: 'chrome', proxyUrl }));
  }
  return proxyClients.get(proxyUrl);
}

function refreshDefault() {
  defaultClient = new Impit({ browser: 'chrome' });
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

function isRetryableStatus(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function getHeader(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()];
}

function getRetryDelayMs(attempt, statusCode, headers) {
  const retryAfter = getHeader(headers, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? Date.now() + (seconds * 1000) : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(30000, Math.max(250, retryAt - Date.now()));
    }
  }

  const base = statusCode === 429 ? 4000 : Math.min(1000 * (2 ** (attempt - 1)), 8000);
  return base + jitter(0, 500);
}

function requestLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'request';
  }
}

async function waitToRetry({ attempt, retries, statusCode = 0, headers, method, url }) {
  if (attempt >= retries) return false;
  const wait = getRetryDelayMs(attempt, statusCode, headers);
  const statusMessage = statusCode ? `HTTP ${statusCode}` : 'Network error';
  log.warning(`${statusMessage} on ${method} ${requestLabel(url)} — retrying in ${Math.round(wait)}ms (attempt ${attempt}/${retries})`);
  await delay(wait);
  return true;
}

export async function fetchJson(url, { headers = {}, proxyUrl, retries = 3, method = 'GET', body, origin, referer } = {}) {
  const reqHeaders = { ...buildReqHeaders({ origin, referer }), ...headers };
  if (body) reqHeaders['content-type'] = 'application/json;charset=UTF-8';
  const retryLimit = Math.max(1, Number.isInteger(Number(retries)) ? Number(retries) : 3);
  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    const client = getClient(proxyUrl);
    const fetchOpts = { method, headers: reqHeaders, timeout: 90000 };
    if (body) fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);

    let response;
    try {
      response = await client.fetch(url, fetchOpts);
    } catch (err) {
      if (isStreamError(err)) {
        if (proxyUrl) proxyClients.delete(proxyUrl);
        else refreshDefault();
      }
      const shouldRetry = await waitToRetry({ attempt, retries: retryLimit, method, url });
      if (!shouldRetry) throw err;
      continue;
    }

    if (!response.ok) {
      const statusCode = response.status;
      if (isRetryableStatus(statusCode)) {
        const shouldRetry = await waitToRetry({
          attempt,
          retries: retryLimit,
          statusCode,
          headers: response.headers,
          method,
          url,
        });
        if (shouldRetry) continue;
      }
      throw new Error(`HTTP ${statusCode} for ${method} ${requestLabel(url)}`);
    }

    return response.json();
  }

  throw new Error(`HTTP ${method} ${requestLabel(url)} failed after ${retryLimit} attempts`);
}

async function fetchText(url, { headers = {}, proxyUrl, retries = 3, origin, referer, xml = false } = {}) {
  const reqHeaders = { ...buildReqHeaders({ origin, referer, xml }), ...headers };
  const retryLimit = Math.max(1, Number.isInteger(Number(retries)) ? Number(retries) : 3);
  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    const client = getClient(proxyUrl);
    let response;
    try {
      response = await client.fetch(url, { headers: reqHeaders, timeout: 90000 });
    } catch (err) {
      if (isStreamError(err)) {
        if (proxyUrl) proxyClients.delete(proxyUrl);
        else refreshDefault();
      }
      const shouldRetry = await waitToRetry({ attempt, retries: retryLimit, method: 'GET', url });
      if (!shouldRetry) throw err;
      continue;
    }

    if (isRetryableStatus(response.status)) {
      const shouldRetry = await waitToRetry({
        attempt,
        retries: retryLimit,
        statusCode: response.status,
        headers: response.headers,
        method: 'GET',
        url,
      });
      if (shouldRetry) continue;
      throw new Error(`HTTP ${response.status} for GET ${requestLabel(url)}`);
    }

    try {
      const responseBody = await response.text();
      return { statusCode: response.status, body: responseBody, headers: response.headers };
    } catch (err) {
      if (isStreamError(err)) {
        if (proxyUrl) proxyClients.delete(proxyUrl);
        else refreshDefault();
      }
      const shouldRetry = await waitToRetry({ attempt, retries: retryLimit, method: 'GET', url });
      if (!shouldRetry) throw err;
    }
  }

  throw new Error(`GET ${requestLabel(url)} failed after ${retryLimit} attempts`);
}

export async function fetchHtml(url, options = {}) {
  return fetchText(url, options);
}

export async function fetchXml(url, options = {}) {
  return fetchText(url, { ...options, xml: true });
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
