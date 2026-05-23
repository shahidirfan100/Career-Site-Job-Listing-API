import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';

import { scrape as scrapeAshby } from './platforms/ashby.js';
import { scrape as scrapeBambooHR } from './platforms/bamboohr.js';
import { scrape as scrapeBreezyHR } from './platforms/breezyhr.js';
import { scrape as scrapeGreenhouse } from './platforms/greenhouse.js';
import { scrape as scrapeICIMS } from './platforms/icims.js';
import { scrape as scrapeJazzHR } from './platforms/jazzhr.js';
import { scrape as scrapeLever } from './platforms/lever.js';
import { scrape as scrapePersonio } from './platforms/personio.js';
import { scrape as scrapeRecruitee } from './platforms/recruitee.js';
import { scrape as scrapeSmartRecruiters } from './platforms/smartrecruiters.js';
import { scrape as scrapeTaleo } from './platforms/taleo.js';
import { scrape as scrapeTeamTailor } from './platforms/teamtailor.js';
import { scrape as scrapeWorkable } from './platforms/workable.js';
import { scrape as scrapeWorkday } from './platforms/workday.js';
import { detectPlatform } from './utils/detector.js';

await Actor.init();

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
    normalized.url = typeof normalized.url === 'string' ? normalized.url : '';

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

    return Object.fromEntries(
        Object.entries(normalized).filter(([, value]) => value !== undefined && value !== ''),
    );
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
        keyword = '',
        location = '',
        postedWithin = 'anytime',
        allow_html_detail_fallback: allowHtmlDetailFallbackRaw = false,
    } = input;

    const resultsWanted = Math.max(1, Number.isFinite(+resultsWantedRaw) ? +resultsWantedRaw : 20);
    const maxPagesNum = Math.max(1, Number.isFinite(+maxPages) ? +maxPages : 5);

    const urlCandidates = Array.isArray(startUrls)
        ? startUrls.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim())
        : [];
    if (typeof startUrl === 'string' && startUrl.trim()) {
        urlCandidates.unshift(startUrl.trim());
    }
    const uniqueUrls = [...new Set(urlCandidates)];

    if (!uniqueUrls.length) {
        log.error('No input URLs provided. Please add one or more career board URLs in startUrls (or startUrl).');
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
        keyword,
        location,
        postedWithin,
        allowHtmlDetailFallback: Boolean(allowHtmlDetailFallbackRaw),
    };

    const allJobs = [];

    for (const candidateUrl of uniqueUrls) {
        const detected = detectPlatform(candidateUrl);
        if (!detected) {
            log.error(`Could not detect the ATS platform from URL: ${candidateUrl}`);
            log.info('Supported platforms: Lever, Greenhouse, Ashby, SmartRecruiters, Workable, Recruitee, BreezyHR, BambooHR, Workday, TeamTailor, Personio, JazzHR, iCIMS, Taleo');
            continue;
        }

        const { platform, slug } = detected;
        log.info(`✅ Detected platform: ${platform.toUpperCase()} | Company slug: ${slug}`);

        let jobs = [];
        try {
            switch (platform) {
                case 'lever':
                    jobs = await scrapeLever(detected, opts);
                    break;
                case 'greenhouse':
                    jobs = await scrapeGreenhouse(detected, opts);
                    break;
                case 'ashby':
                    jobs = await scrapeAshby(detected, opts);
                    break;
                case 'smartrecruiters':
                    jobs = await scrapeSmartRecruiters(detected, opts);
                    break;
                case 'workable':
                    jobs = await scrapeWorkable(detected, opts);
                    break;
                case 'recruitee':
                    jobs = await scrapeRecruitee(detected, opts);
                    break;
                case 'bamboohr':
                    jobs = await scrapeBambooHR(detected, opts);
                    break;
                case 'breezyhr':
                    jobs = await scrapeBreezyHR(detected, opts);
                    break;
                case 'workday':
                    jobs = await scrapeWorkday(detected, opts);
                    break;
                case 'teamtailor':
                    jobs = await scrapeTeamTailor(detected, opts);
                    break;
                case 'personio':
                    jobs = await scrapePersonio(detected, opts);
                    break;
                case 'jazzhr':
                    jobs = await scrapeJazzHR(detected, opts);
                    break;
                case 'icims':
                    jobs = await scrapeICIMS(detected, opts);
                    break;
                case 'taleo':
                    jobs = await scrapeTaleo(detected, opts);
                    break;
                default:
                    log.error(`Platform "${platform}" is detected but not yet implemented.`);
            }
        } catch (err) {
            log.error(`Scraping failed for ${platform} (${slug}): ${err.message}\n${err.stack}`);
        }

        allJobs.push(...jobs);
    }

    // ── Save results ─────────────────────────────────────────────────────────
    const finalJobs = dedupeJobs(allJobs).slice(0, resultsWanted);

    if (!finalJobs.length) {
        log.warning('No jobs were extracted after normalization. The company may have no open positions, or the URL may be incorrect.');
    } else {
        await Dataset.pushData(finalJobs);
        log.info(`✅ Saved ${finalJobs.length} jobs from ${uniqueUrls.length} input URL(s)`);
    }
}

await main().catch(async (err) => {
    log.error(`Fatal error: ${err.message}`);
    await Actor.exit({ exitCode: 1 });
});

await Actor.exit();
