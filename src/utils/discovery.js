import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';

import { detectPlatform } from './detector.js';
import { fetchHtml } from './http.js';

const ATS_HOST_PATTERN = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)*(?:lever\.co|greenhouse\.io|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com|breezy\.hr|bamboohr\.com|myworkdayjobs\.com|myworkdaysite\.com|teamtailor\.com|teamtailor\.net|personio\.(?:de|com)|jazz\.co|icims\.com|taleo\.net|brassring\.com|jobvite\.com|pinpointhq\.com|rippling\.com|manatal\.com|careers-page\.com)[^\s"'<>]*/gi;
const MAX_DISCOVERY_JSON_NODES = 4000;
const MAX_DATA_ENDPOINT_PROBES = 4;
const MAX_DATA_ENDPOINT_BYTES = 5_000_000;

const has = (value, key) => Object.hasOwn(value || {}, key) && value[key] !== null && value[key] !== undefined;

function getRecordArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return null;
    for (const key of ['jobs', 'jobPostings', 'postings', 'offers', 'results', 'data', 'content', 'positions', 'items', 'result']) {
        if (Array.isArray(value[key])) return value[key];
    }
    return null;
}

function signatureForRows(rows) {
    const samples = rows.filter((row) => row && typeof row === 'object').slice(0, 5);
    if (!samples.length) return null;

    const every = (predicate) => samples.every(predicate);
    if (every((row) => has(row, 'text') && has(row, 'hostedUrl') && has(row, 'categories'))) return 'lever';
    if (every((row) => has(row, 'position_name') && has(row, 'organization_name') && has(row, 'is_pinned_in_career_page'))) return 'manatal';
    if (every((row) => has(row, 'uuid') && has(row, 'name') && has(row, 'workLocation'))) return 'rippling';
    if (every((row) => has(row, 'employment_type') && has(row, 'workplace_type') && has(row, 'location') && has(row, 'title'))) return 'pinpoint';
    if (every((row) => has(row, 'jobUrl') && has(row, 'locationName') && has(row, 'teamName') && has(row, 'title'))) return 'ashby';
    if (every((row) => has(row, 'absolute_url') && has(row, 'title') && (has(row, 'content') || has(row, 'departments')))) return 'greenhouse';
    if (every((row) => has(row, 'careers_url') && has(row, 'employment_type_code') && has(row, 'title') && has(row, 'company'))) return 'recruitee';
    if (every((row) => has(row, 'jobOpeningName') && (has(row, 'departmentLabel') || has(row, 'employmentStatusLabel')) && (has(row, 'id') || has(row, 'jobId')))) return 'bamboohr';
    if (every((row) => has(row, '_id') && has(row, 'friendly_id') && has(row, 'creation_date') && (has(row, 'name') || has(row, 'title')))) return 'breezyhr';
    if (every((row) => has(row, 'releasedDate') && has(row, 'typeOfEmployment') && has(row, 'id') && has(row, 'name') && row.location && typeof row.location === 'object' && has(row.location, 'fullLocation'))) return 'smartrecruiters';
    if (every((row) => has(row, 'shortcode') && has(row, 'title') && (has(row, 'application_url') || has(row, 'published_on')) && (has(row, 'employment_type') || has(row, 'telecommuting')))) return 'workable';
    if (every((row) => has(row, 'id') && has(row, 'title') && has(row, 'externalPath') && (has(row, 'locationsText') || has(row, 'bulletFields') || has(row, 'jobPostingId')))) return 'workday';
    if (every((row) => has(row, 'id') && row.attributes && has(row.attributes, 'jobDescriptions') && (has(row.attributes, 'office') || has(row.attributes, 'employment_type')))) return 'personio';
    if (every((row) => row.attributes && has(row.attributes, 'career-page-url') && has(row.attributes, 'employment-type') && has(row.attributes, 'title'))) return 'teamtailor';
    return null;
}

function wrapRowsForAdapter(platform, rows) {
    if (['lever', 'manatal', 'pinpoint', 'rippling', 'recruitee'].includes(platform)) return rows;
    const collectionKey = {
        ashby: 'jobs',
        bamboohr: 'result',
        breezyhr: 'positions',
        greenhouse: 'jobs',
        personio: 'data',
        smartrecruiters: 'content',
        teamtailor: 'jobs',
        workable: 'jobs',
        workday: 'jobPostings',
    }[platform] || 'jobs';
    return { [collectionKey]: rows };
}

function findPlatformPayload(root) {
    const queue = [{ value: root, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < MAX_DISCOVERY_JSON_NODES) {
        const { value, depth } = queue.shift();
        visited++;
        if (!value || typeof value !== 'object' || depth > 7) continue;

        const rows = getRecordArray(value);
        const platform = rows && signatureForRows(rows);
        if (platform) {
            const envelope = wrapRowsForAdapter(platform, rows);
            return { platform, prefetchedData: envelope };
        }

        const entries = Array.isArray(value) ? value.slice(0, 20).map((entry) => ['', entry]) : Object.entries(value);
        for (const [key, child] of entries) {
            if (!child || typeof child !== 'object') continue;
            if (typeof key === 'string' && /^(?:jobs|jobPostings|postings|offers|results|data|content|positions|items|result)$/i.test(key) && Array.isArray(child)) {
                const childPlatform = signatureForRows(child);
                if (childPlatform) {
                    const envelope = wrapRowsForAdapter(childPlatform, child);
                    return { platform: childPlatform, prefetchedData: envelope };
                }
            }
            queue.push({ value: child, depth: depth + 1 });
        }
    }
    return null;
}

function collectCandidateUrls(html, pageUrl) {
    const $ = cheerioLoad(html);
    const candidates = [];
    const attributes = ['href', 'src', 'action', 'data-href', 'data-url', 'data-careers-url', 'data-job-board-url'];

    for (const attribute of attributes) {
        $(`[${attribute}]`).each((_, element) => {
            const value = $(element).attr(attribute)?.trim();
            if (value) candidates.push(value);
        });
    }
    for (const match of html.matchAll(ATS_HOST_PATTERN)) candidates.push(match[0]);

    const resolved = [];
    const seen = new Set();
    for (const candidate of candidates) {
        try {
            const parsed = new URL(candidate.replace(/\\\//g, '/').replace(/&amp;/g, '&'), pageUrl);
            if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(parsed.href)) continue;
            seen.add(parsed.href);
            resolved.push(parsed.href);
        } catch {
            // Invalid and relative script fragments are not usable board URLs.
        }
    }
    return resolved;
}

function collectEmbeddedJson(html) {
    const $ = cheerioLoad(html);
    const payloads = [];
    const scripts = $('script').toArray();
    for (const script of scripts) {
        const content = $(script).html()?.trim();
        if (!content || content.length > 5_000_000) continue;
        const type = ($(script).attr('type') || '').toLowerCase();
        const id = ($(script).attr('id') || '').toLowerCase();
        const appearsJson = content.startsWith('{') || content.startsWith('[');
        if (!type.includes('json') && !/(?:next|initial|state|data|career)/.test(id) && !appearsJson) continue;
        const candidates = [content];
        const assignedJson = content.match(/(?:__NEXT_DATA__|__INITIAL_STATE__|__APOLLO_STATE__)\s*=\s*({[\s\S]*?})\s*;?\s*$/);
        if (assignedJson?.[1]) candidates.push(assignedJson[1]);
        for (const candidate of candidates) {
            try {
                payloads.push(JSON.parse(candidate));
            } catch {
                // Most scripts are executable JS rather than standalone JSON.
            }
        }
    }

    const trimmed = html.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { payloads.unshift(JSON.parse(trimmed)); } catch { /* Not a JSON response. */ }
    }
    return payloads;
}

function collectDataEndpointUrls(html, pageUrl) {
    const $ = cheerioLoad(html);
    const candidates = [];
    $('script[src], link[href], [data-url], [data-api-url], [data-endpoint], [data-jobs-url], form[action]').each((_, element) => {
        const value = $(element).attr('src')
            || $(element).attr('href')
            || $(element).attr('data-url')
            || $(element).attr('data-api-url')
            || $(element).attr('data-endpoint')
            || $(element).attr('data-jobs-url')
            || $(element).attr('action');
        if (value) candidates.push(value.trim());
    });

    const decoded = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    for (const match of decoded.matchAll(/(?:https?:\/\/[^\s"'<>`]+|\/\/(?:[^\s"'<>`]+)|\/(?:api|open|careers?)[^\s"'<>`]*)/gi)) {
        candidates.push(match[0]);
    }

    const pageOrigin = new URL(pageUrl).origin;
    const resolved = [];
    const seen = new Set();
    for (const candidate of candidates) {
        try {
            const parsed = new URL(candidate.replace(/\\\//g, '/').replace(/&amp;/g, '&'), pageUrl);
            if (parsed.origin !== pageOrigin || seen.has(parsed.href)) continue;
            const looksLikeData = /(?:^|\/)(?:api|open)(?:\/|$)|\.json(?:$)|(?:jobs|postings|offers|positions)(?:\.json)?\/?$/i.test(parsed.pathname);
            if (!looksLikeData) continue;
            seen.add(parsed.href);
            resolved.push(parsed.href);
        } catch {
            // Ignore invalid, non-URL script fragments.
        }
    }
    return resolved;
}

function discoverImplicitEndpoint(html, pageUrl) {
    const decoded = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');

    const workday = decoded.match(/\/wday\/cxs\/([^\s"'<>/?#]+)\/([^\s"'<>/?#]+)\/jobs\b/i);
    if (workday) {
        const endpoint = new URL(`/wday/cxs/${workday[1]}/${workday[2]}/jobs`, pageUrl).href;
        const detected = detectPlatform(endpoint);
        if (detected?.platform === 'workday') return detected;
    }

    const manatal = decoded.match(/(?:https?:\/\/[^\s"'<>]+)?\/open\/v\d+\/career-page\/([a-z0-9_-]+)\/jobs\/?/i);
    if (manatal) {
        return { platform: 'manatal', slug: manatal[1], clientSlug: manatal[1], rawUrl: pageUrl };
    }

    const lever = decoded.match(/\/v0\/postings\/([^\s"'<>/?#]+)/i);
    if (lever) return { platform: 'lever', slug: lever[1], rawUrl: pageUrl };

    const greenhouse = decoded.match(/\/v1\/boards\/([^\s"'<>/?#]+)\/jobs\b/i);
    if (greenhouse) return { platform: 'greenhouse', slug: greenhouse[1], rawUrl: pageUrl };

    const ashby = decoded.match(/\/posting-api\/job-board\/([^\s"'<>/?#]+)/i);
    if (ashby) return { platform: 'ashby', slug: ashby[1], rawUrl: pageUrl };

    const smartRecruiters = decoded.match(/\/v1\/companies\/([^\s"'<>/?#]+)\/postings\b/i);
    if (smartRecruiters) return { platform: 'smartrecruiters', slug: smartRecruiters[1], rawUrl: pageUrl };

    const rippling = decoded.match(/\/platform\/api\/ats\/v1\/board\/([^\s"'<>/?#]+)\/jobs\b/i);
    if (rippling) return { platform: 'rippling', slug: rippling[1], rawUrl: pageUrl };

    const jobvite = decoded.match(/(?:https?:\/\/app\.jobvite\.com)?\/CompanyJobs\/Xml\.aspx\?[^\s"'<>]*\bc=([^&\s"'<>]+)/i);
    if (jobvite) {
        const companyEId = decodeURIComponent(jobvite[1]);
        return { platform: 'jobvite', slug: companyEId, companyEId, rawUrl: pageUrl };
    }
    const jobviteEId = decoded.match(/companyEId\s*[:=]\s*['"]([^'"]+)['"]/i);
    if (jobviteEId && /jobvite/i.test(decoded)) {
        const companyEId = jobviteEId[1];
        return { platform: 'jobvite', slug: companyEId, companyEId, rawUrl: pageUrl };
    }

    // Some Teamtailor customers use a branded domain; only accept a vendor asset/API marker.
    if (/teamtailor\.(?:com|net)|data-teamtailor|teamtailor[-_]jobs/i.test(decoded)) {
        const parsed = new URL(pageUrl);
        return { platform: 'teamtailor', slug: parsed.hostname.split('.')[0], rawUrl: pageUrl };
    }
    return null;
}

/** Resolve strong ATS signals from already-fetched HTML or JSON without network I/O. */
export function detectPlatformFromPage(body, pageUrl) {
    if (/<workzag-jobs\b/i.test(body) && /<position\b/i.test(body)) {
        const parsed = new URL(pageUrl);
        return { platform: 'personio', slug: parsed.hostname.split('.')[0], rawUrl: pageUrl };
    }

    for (const candidateUrl of collectCandidateUrls(body, pageUrl)) {
        const detected = detectPlatform(candidateUrl);
        if (detected) {
            return { ...detected, rawUrl: detected.rawUrl || candidateUrl };
        }
    }

    const implicit = discoverImplicitEndpoint(body, pageUrl);
    if (implicit) return implicit;

    for (const payload of collectEmbeddedJson(body)) {
        const match = findPlatformPayload(payload);
        if (!match) continue;
        const parsed = new URL(pageUrl);
        const slug = match.platform === 'manatal'
            ? (parsed.pathname.split('/').filter(Boolean)[0] || parsed.hostname.split('.')[0])
            : parsed.hostname.split('.')[0];
        return { platform: match.platform, slug, clientSlug: match.platform === 'manatal' ? slug : undefined, rawUrl: pageUrl, prefetchedData: match.prefetchedData };
    }

    return null;
}

/**
 * Inspect a supplied careers page for ATS URLs, implicit endpoint paths, vendor
 * embed markers, and distinctive ATS job payload schemas. Generic job fields
 * alone are deliberately insufficient to guess a provider.
 */
export async function discoverPlatform(pageUrl, { proxyUrl } = {}) {
    let response;
    try {
        response = await fetchHtml(pageUrl, {
            proxyUrl,
            retries: 2,
            headers: { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
        });
    } catch (err) {
        log.warning(`Could not inspect the supplied careers page for ATS signals: ${err.message}`);
        return null;
    }

    if (response.statusCode < 200 || response.statusCode >= 400) {
        log.warning(`The supplied careers page returned HTTP ${response.statusCode} during ATS discovery.`);
        return null;
    }

    const html = String(response.body || '');
    const detected = detectPlatformFromPage(html, pageUrl);
    if (detected) log.info(`Discovered ${detected.platform.toUpperCase()} from fetched careers-page signals.`);
    if (detected) return detected;

    for (const endpointUrl of collectDataEndpointUrls(html, pageUrl).slice(0, MAX_DATA_ENDPOINT_PROBES)) {
        try {
            const endpoint = await fetchHtml(endpointUrl, {
                proxyUrl,
                retries: 1,
                headers: { accept: 'application/json,text/json;q=0.9,*/*;q=0.5' },
            });
            if (endpoint.statusCode < 200 || endpoint.statusCode >= 300) continue;
            const body = String(endpoint.body || '');
            if (body.length > MAX_DATA_ENDPOINT_BYTES) continue;
            const contentType = endpoint.headers?.get?.('content-type') || '';
            const trimmed = body.trimStart();
            if (!/json/i.test(contentType) && !trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
            const endpointDetection = detectPlatformFromPage(body, endpointUrl);
            if (!endpointDetection) continue;
            log.info(`Discovered ${endpointDetection.platform.toUpperCase()} from a linked JSON endpoint.`);
            return endpointDetection;
        } catch (err) {
            log.debug(`Could not inspect a linked career JSON endpoint: ${err.message}`);
        }
    }
    return null;
}
