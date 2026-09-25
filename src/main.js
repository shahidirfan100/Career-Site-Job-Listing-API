import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';

import { scrape as scrapeAshby } from './platforms/ashby.js';
import { scrape as scrapeBambooHR } from './platforms/bamboohr.js';
import { scrape as scrapeBreezyHR } from './platforms/breezyhr.js';
import { scrape as scrapeGreenhouse } from './platforms/greenhouse.js';
import { scrape as scrapeICIMS } from './platforms/icims.js';
import { scrape as scrapeJazzHR } from './platforms/jazzhr.js';
import { scrape as scrapeJobvite } from './platforms/jobvite.js';
import { scrape as scrapeLever } from './platforms/lever.js';
import { scrape as scrapeManatal } from './platforms/manatal.js';
import { scrape as scrapePersonio } from './platforms/personio.js';
import { scrape as scrapePinpoint } from './platforms/pinpoint.js';
import { scrape as scrapeRecruitee } from './platforms/recruitee.js';
import { scrape as scrapeRippling } from './platforms/rippling.js';
import { scrape as scrapeSmartRecruiters } from './platforms/smartrecruiters.js';
import { scrape as scrapeTaleo } from './platforms/taleo.js';
import { scrape as scrapeTeamTailor } from './platforms/teamtailor.js';
import { scrape as scrapeWorkable } from './platforms/workable.js';
import { scrape as scrapeWorkday } from './platforms/workday.js';
import { detectPlatform } from './utils/detector.js';
import { discoverPlatform } from './utils/discovery.js';

await Actor.init();

const platformScrapers = {
    ashby: scrapeAshby,
    bamboohr: scrapeBambooHR,
    breezyhr: scrapeBreezyHR,
    greenhouse: scrapeGreenhouse,
    icims: scrapeICIMS,
    jobvite: scrapeJobvite,
    jazzhr: scrapeJazzHR,
    lever: scrapeLever,
    manatal: scrapeManatal,
    pinpoint: scrapePinpoint,
    personio: scrapePersonio,
    recruitee: scrapeRecruitee,
    rippling: scrapeRippling,
    smartrecruiters: scrapeSmartRecruiters,
    taleo: scrapeTaleo,
    teamtailor: scrapeTeamTailor,
    workable: scrapeWorkable,
    workday: scrapeWorkday,
};

const TRACKING_QUERY_PARAMS = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_reader',
    'utm_name',
    'utm_cid',
    'utm_referrer',
    'utm_viz_id',
    'ref',
    'source',
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'igshid',
]);

function canonicalizeUrl(value) {
    const asText = toText(value);
    if (!asText) return '';
    try {
        const parsed = new URL(asText);
        parsed.hash = '';
        for (const key of [...parsed.searchParams.keys()]) {
            const lower = key.toLowerCase();
            if (lower.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lower)) {
                parsed.searchParams.delete(key);
            }
        }
        if (parsed.pathname.length > 1) {
            parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        }
        return parsed.toString();
    } catch {
        return asText;
    }
}

function pruneEmptyDeep(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }
    if (Array.isArray(value)) {
        const cleaned = value.map((item) => pruneEmptyDeep(item)).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, item]) => [key, pruneEmptyDeep(item)])
            .filter(([, item]) => item !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return value;
}

function toText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value
            .map((item) => toText(item))
            .filter(Boolean)
            .join(', ')
            .trim();
    }
    if (typeof value === 'object') {
        const preferred = value.name ?? value.title ?? value.label ?? value.value ?? value.code ?? value.id;
        if (preferred !== undefined && preferred !== null) return toText(preferred);
    }
    return '';
}

function normalizeJob(job) {
    if (!job || typeof job !== 'object') return null;
    const normalized = {};
    for (const [key, value] of Object.entries(job)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed !== '') normalized[key] = trimmed;
            continue;
        }
        if (Array.isArray(value)) {
            const filtered = value
                .map((item) => (typeof item === 'string' ? item.trim() : item))
                .filter((item) => item !== null && item !== undefined && item !== '');
            if (filtered.length) normalized[key] = filtered;
            continue;
        }
        normalized[key] = value;
    }

    const stringFields = [
        'job_id',
        'title',
        'company',
        'location',
        'city',
        'state',
        'country',
        'team',
        'department',
        'job_type',
        'workplace_type',
        'remote_type',
        'date_posted',
        'updated_at',
        'url',
        'apply_url',
        'description',
        'platform',
        'source_host',
        'scraped_at',
    ];
    for (const field of stringFields) {
        if (field in normalized) {
            const value = toText(normalized[field]);
            if (value) normalized[field] = value;
            else delete normalized[field];
        }
    }

    normalized.title = typeof normalized.title === 'string' ? normalized.title : '';
    normalized.company = typeof normalized.company === 'string' ? normalized.company : '';
    normalized.url = canonicalizeUrl(normalized.url);
    normalized.apply_url = canonicalizeUrl(normalized.apply_url || normalized.url);

    if (!normalized.title || !normalized.url) return null;

    if (typeof normalized.remote !== 'boolean') {
        const rawRemote = normalized.remote;
        if (typeof rawRemote === 'string') {
            const v = rawRemote.trim().toLowerCase();
            if (['true', 'yes', 'remote', 'fully remote'].includes(v)) normalized.remote = true;
            else if (['false', 'no', 'onsite', 'on-site', 'hybrid'].includes(v)) normalized.remote = false;
            else {
                normalized.remote_type = normalized.remote_type || rawRemote;
                delete normalized.remote;
            }
        } else {
            delete normalized.remote;
        }
    }

    if (!normalized.apply_url) normalized.apply_url = normalized.url;
    if (!normalized.scraped_at) normalized.scraped_at = new Date().toISOString();
    if (!normalized.source_host) normalized.source_host = (() => {
        try {
            return new URL(normalized.url).hostname;
        } catch {
            return undefined;
        }
    })();

    const cleaned = pruneEmptyDeep(normalized);
    if (!cleaned || typeof cleaned !== 'object') return null;
    return cleaned;
}

function dedupeJobs(jobs) {
    const seen = new Set();
    const out = [];
    for (const job of jobs) {
        const normalized = normalizeJob(job);
        if (!normalized) continue;
        const key = [
            normalized.platform || '',
            normalized.job_id || '',
            normalized.url || '',
            normalized.apply_url || '',
            normalized.title.toLowerCase(),
            (normalized.company || '').toLowerCase(),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

async function main() {
    const input = (await Actor.getInput()) || {};

    const {
        startUrl,
        startUrls,
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPages = 5,
        proxyConfiguration: proxyInput,
    } = input;

    const requestedResults = Number(resultsWantedRaw);
    const requestedPages = Number(maxPages);
    const resultsWanted = Number.isFinite(requestedResults) ? Math.max(1, Math.trunc(requestedResults)) : 20;
    const maxPagesNum = Number.isFinite(requestedPages) ? Math.max(1, Math.trunc(requestedPages)) : 5;

    const urlCandidates = Array.isArray(startUrls)
        ? startUrls.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim())
        : [];
    if (typeof startUrl === 'string' && startUrl.trim()) {
        urlCandidates.unshift(startUrl.trim());
    }
    const uniqueUrls = [...new Set(urlCandidates)];

    if (!uniqueUrls.length) {
        log.error('Add at least one career board or careers-page URL. This Actor collects listings from the URLs you provide.');
        await Actor.exit({ exitCode: 1 });
        return;
    }

    // ── Proxy ────────────────────────────────────────────────────────────────
    const proxyConfiguration = proxyInput
        ? await Actor.createProxyConfiguration(proxyInput)
        : undefined;

    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

    // Shared options for all platforms
    const opts = {
        resultsWanted,
        maxPages: maxPagesNum,
        proxyUrl,
        proxyConfiguration,
    };

    let totalSaved = 0;
    let urlIndex = 0;

    for (const candidateUrl of uniqueUrls) {
        if (totalSaved >= resultsWanted) break;
        // Jitter delay between different URLs to avoid request pattern detection
        if (urlIndex > 0) {
            const delayMs = 1500 + Math.random() * 3500;
            log.info(`Waiting ${Math.round(delayMs)}ms before processing next URL...`);
            await new Promise((r) => { setTimeout(r, delayMs); });
        }
        urlIndex++;
        let detected = detectPlatform(candidateUrl);
        if (!detected) {
            detected = await discoverPlatform(candidateUrl, { proxyUrl });
        }
        if (!detected) {
            log.warning(`No supported ATS was found in the supplied URL or its career-page links: ${candidateUrl}`);
            continue;
        }

        const { platform, slug } = detected;
        log.info(`Platform detected: ${platform.toUpperCase()} | Company slug: ${slug}`);

        let jobs = [];
        try {
            const scraper = platformScrapers[platform];
            if (!scraper) {
                log.warning(`Platform "${platform}" is detected but has no adapter.`);
                continue;
            }
            const remaining = Math.max(1, resultsWanted - totalSaved);
            jobs = await scraper(detected, { ...opts, resultsWanted: remaining });
        } catch (err) {
            log.error(`Scraping failed for ${platform} (${slug}): ${err.message}`);
        }

        if (jobs.length) {
            const remaining = Math.max(0, resultsWanted - totalSaved);
            const batch = dedupeJobs(jobs).slice(0, remaining);
            if (batch.length) {
                await Dataset.pushData(batch);
                totalSaved += batch.length;
                log.info(`Saved ${batch.length} jobs from ${platform}. Total: ${totalSaved}/${resultsWanted}`);
            }
        }
    }

    if (!totalSaved) {
        log.warning('No jobs were extracted after normalization.');
    }
    log.info(`Done | saved=${totalSaved} | urls=${urlIndex}`);
}

await main().catch(async (err) => {
    log.error(`Fatal error: ${err.message}`);
    await Actor.exit({ exitCode: 1 });
});

await Actor.exit();
