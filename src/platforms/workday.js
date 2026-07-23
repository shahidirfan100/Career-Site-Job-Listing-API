import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';

import { fetchJson } from '../utils/http.js';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGES_CAP = 500;
const LIST_REQUEST_RETRIES = 4;
const DETAIL_REQUEST_RETRIES = 3;
const DETAIL_CONCURRENCY = 6;
const MS_IN_DAY = 24 * 60 * 60 * 1000;

const LOCATION_ALIASES = {
    'united states of america': ['united states', 'usa'],
    'united states': ['united states of america', 'usa'],
    usa: ['united states', 'united states of america'],
};

const dedupeStrings = (values) => [...new Set(
    (values || []).filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean),
)];

const cleanText = (html) => {
    if (!html) return '';
    const $ = cheerioLoad(html);
    $('script, style, noscript, iframe').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
};

const deriveConfigFromUrl = (rawUrl) => {
    const parsed = new URL(rawUrl);
    const {origin} = parsed;
    const tenant = parsed.hostname.split('.')[0];
    const pathSegments = parsed.pathname.split('/').filter(Boolean).map((s) => s.trim()).filter(Boolean);

    const recruitingIndex = pathSegments.findIndex((s) => s.toLowerCase() === 'recruiting');
    if (recruitingIndex >= 0 && pathSegments[recruitingIndex + 1]) {
        const tenantFromPath = pathSegments[recruitingIndex + 1];
        const boardFromPath = pathSegments[recruitingIndex + 2] || 'external';
        const jobsUrlCandidates = dedupeStrings([
            `${origin}/wday/cxs/${tenantFromPath}/${boardFromPath}/jobs`,
            `${origin}/wday/cxs/${tenantFromPath}/${boardFromPath.toLowerCase()}/jobs`,
        ]);
        const jobsUrlBase = jobsUrlCandidates[0];
        const publicBase = `${origin}/${pathSegments.slice(0, recruitingIndex + 3).join('/')}`.replace(/\/+$/, '');
        return {
            origin,
            tenant: tenantFromPath,
            jobsUrl: jobsUrlBase,
            jobsUrlCandidates,
            jobsApiBase: jobsUrlBase.replace(/\/jobs$/, ''),
            publicBase,
            referer: rawUrl,
        };
    }

    if (parsed.pathname.includes('/wday/cxs/')) {
        const cxsIndex = pathSegments.findIndex((s) => s === 'wday');
        if (cxsIndex === -1 || cxsIndex + 2 >= pathSegments.length) {
            throw new Error(`Unsupported Workday API structure in ${rawUrl}`);
        }
        const importantSegments = pathSegments.slice(cxsIndex + 2);
        const siteSegments = importantSegments.slice(1, -1);
        const publicSegments = siteSegments.length ? siteSegments : [importantSegments.at(1) || importantSegments.at(0) || tenant];
        const jobsUrlCandidates = dedupeStrings([
            `${origin}/wday/cxs/${importantSegments.join('/')}`,
            `${origin}/wday/cxs/${importantSegments.map((s) => s.toLowerCase()).join('/')}`,
        ]);
        const jobsUrlBase = jobsUrlCandidates[0];
        return {
            origin, tenant,
            jobsUrl: jobsUrlBase,
            jobsUrlCandidates,
            jobsApiBase: jobsUrlBase.replace(/\/jobs$/, ''),
            publicBase: `${origin}/${publicSegments.join('/')}`.replace(/\/+$/, ''),
            referer: rawUrl,
        };
    }

    const siteSegments = pathSegments.length ? pathSegments : [tenant];
    const lowerSiteSegments = siteSegments.map((s) => s.toLowerCase());
    const jobsUrlCandidates = dedupeStrings([
        `${origin}/wday/cxs/${[tenant, ...siteSegments].join('/')}/jobs`,
        `${origin}/wday/cxs/${[tenant, ...lowerSiteSegments].join('/')}/jobs`,
        `${origin}/wday/cxs/${siteSegments.join('/')}/jobs`,
        `${origin}/wday/cxs/${lowerSiteSegments.join('/')}/jobs`,
        `${origin}/wday/cxs/${tenant}/${siteSegments.at(-1) || tenant}/jobs`,
        `${origin}/wday/cxs/${tenant}/${lowerSiteSegments.at(-1) || tenant}/jobs`,
    ]);
    const jobsUrlBase = jobsUrlCandidates[0];
    return {
        origin, tenant,
        jobsUrl: jobsUrlBase,
        jobsUrlCandidates,
        jobsApiBase: jobsUrlBase.replace(/\/jobs$/, ''),
        publicBase: `${origin}/${siteSegments.join('/')}`.replace(/\/+$/, ''),
        referer: parsed.href,
    };
};

const buildSearchPayload = ({ keyword, offset, limit }) => ({
    appliedFacets: {},
    limit,
    offset,
    searchText: keyword || '',
    userSelectedLanguage: 'en',
});

const normalizeForMatch = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const buildLocationNeedles = (location) => {
    const normalized = normalizeForMatch(location);
    if (!normalized) return [];
    const needles = new Set([normalized]);
    for (const alias of (LOCATION_ALIASES[normalized] || [])) {
        const n = normalizeForMatch(alias);
        if (n) needles.add(n);
    }
    return [...needles];
};

const shouldIncludeByLocation = ({ locationNeedles, locationValues, allowUnknown = false }) => {
    if (!locationNeedles.length) return true;
    const candidates = (locationValues || []).map((v) => normalizeForMatch(v)).filter(Boolean);
    if (!candidates.length) return allowUnknown;
    return candidates.some((c) => locationNeedles.some((n) => c.includes(n) || n.includes(c)));
};

const parsePostedRelativeDays = (value) => {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized.includes('posted today')) return 0;
    if (normalized.includes('posted yesterday')) return 1;
    const match = normalized.match(/posted\s+(\d+)\+?\s+(hour|hours|day|days|week|weeks|month|months|year|years)/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    switch (match[2]) {
        case 'hour': case 'hours': return amount / 24;
        case 'day': case 'days': return amount;
        case 'week': case 'weeks': return amount * 7;
        case 'month': case 'months': return amount * 30;
        case 'year': case 'years': return amount * 365;
        default: return null;
    }
};

const calcPostedDiffDays = (job, jobPostingInfo) => {
    for (const candidate of [jobPostingInfo?.startDate, jobPostingInfo?.postedOn, job?.postedOn]) {
        if (!candidate || typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        const timestamp = Date.parse(trimmed);
        if (!Number.isNaN(timestamp)) return Math.max(0, (Date.now() - timestamp) / MS_IN_DAY);
        const rel = parsePostedRelativeDays(trimmed);
        if (rel !== null) return rel;
    }
    return null;
};

const shouldIncludeByPostedWithin = ({ job, jobPostingInfo, maxAgeDays }) => {
    if (!Number.isFinite(maxAgeDays)) return true;
    const diff = calcPostedDiffDays(job, jobPostingInfo);
    return diff === null || diff <= maxAgeDays;
};

const extractIsoDate = (value) => {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : new Date(ts).toISOString();
};

const splitOnDelimiters = (value) => {
    if (!value || typeof value !== 'string') return [];
    return value.replace(/[|/]/g, ',').split(/[,;]/).map((p) => p.trim()).filter(Boolean);
};

const resolveLocation = ({ job, detailInfo }) => {
    const country = detailInfo?.country?.descriptor || detailInfo?.jobRequisitionLocation?.country?.descriptor || null;
    let city = null; let state = null;
    for (const source of [detailInfo?.city, detailInfo?.jobRequisitionLocation?.descriptor, detailInfo?.location?.descriptor, job?.locationsText]) {
        if (!source) continue;
        const candidate = typeof source === 'string' ? source : source.descriptor || source.name;
        if (!candidate) continue;
        const parts = splitOnDelimiters(candidate);
        if (parts.length === 1) { if (!city) city = parts[0]; }
        else if (parts.length === 2) { if (!state) state = parts[0]; if (!city) city = parts[1]; }
        else { state = state || parts.at(-2); city = city || parts.at(-1); }
        if (city) break;
    }
    return { city: city || null, state: state || null, country: country || null };
};

const pruneEmpty = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') { const t = value.trim(); return t || undefined; }
    if (Array.isArray(value)) { const c = value.map(pruneEmpty).filter((e) => e !== undefined); return c.length ? c : undefined; }
    if (typeof value === 'object') {
        const entries = [];
        for (const [k, v] of Object.entries(value)) { const c = pruneEmpty(v); if (c !== undefined) entries.push([k, c]); }
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return value;
};

const deriveJobUrls = ({ requestUrl, meta, job }) => {
    const {origin} = new URL(requestUrl);
    const externalPath = job.externalPath || job.externalUrl;
    const jobsUrlBase = `${origin}${new URL(requestUrl).pathname}`;
    const jobsApiBase = meta?.jobsApiBase || jobsUrlBase.replace(/\/jobs$/, '');
    const publicBase = meta?.publicBase || origin;
    const postingId = job.jobPostingId || job.id || job.jobReqId;

    const jobApiUrl = (() => {
        if (typeof externalPath === 'string') {
            if (externalPath.startsWith('http') && externalPath.includes('/wday/')) return externalPath;
            if (externalPath.startsWith('/job/')) return `${jobsApiBase}${externalPath}`;
            if (externalPath.includes('/job/')) return `${jobsApiBase}${externalPath.slice(externalPath.indexOf('/job/'))}`;
        }
        if (postingId) return `${jobsApiBase}/jobPosting/${postingId}`;
        return (job.externalUrl?.includes('/wday/')) ? job.externalUrl : null;
    })();

    const jobPublicUrl = (() => {
        if (typeof externalPath === 'string' && externalPath.startsWith('http')) return externalPath;
        if (typeof externalPath === 'string') {
            return externalPath.startsWith('/job/') ? `${publicBase}${externalPath}` : `${origin}${externalPath}`;
        }
        if (job.externalUrl) return job.externalUrl;
        if (job.thirdPartyApplyUrl) return job.thirdPartyApplyUrl;
        if (postingId) return `${publicBase}/job/${postingId}`;
        return null;
    })();

    return { jobApiUrl, jobPublicUrl, postingId };
};

/**
 * Scrape jobs from Workday via direct API calls — NO browser needed.
 * Workday exposes /wday/cxs/{tenant}/{board}/jobs as a POST endpoint.
 */
export async function scrape({ slug: _slug, board: _board, rawUrl }, { resultsWanted = 20, maxPages = 5, proxyConfiguration, keyword = '', location = '', postedWithin = 'anytime' } = {}) {
    const POSTED_WITHIN_WINDOWS = { anytime: Infinity, '24h': 1, '7d': 7, '30d': 30, '60d': 60, '90d': 90 };
    const postedWindowDays = POSTED_WITHIN_WINDOWS[postedWithin?.toLowerCase()] ?? Infinity;
    const locationNeedles = buildLocationNeedles(location);
    const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    const keywordPhrase = normalizeForMatch(normalizedKeyword);
    const keywordTokens = keywordPhrase ? keywordPhrase.split(' ').filter(Boolean) : [];

    log.info(`[Workday] Starting API-based scrape for: ${rawUrl}`);

    let config;
    try {
        config = deriveConfigFromUrl(rawUrl);
        config.keyword = normalizedKeyword;
    } catch (err) {
        log.error(`[Workday] Could not derive API config from URL: ${err.message}`);
        return [];
    }

    let saved = 0;
    let offset = 0;
    let page = 0;
    let total = null;
    let limit = DEFAULT_PAGE_LIMIT;
    const seen = new Set();
    const allRecords = [];
    const safeMaxPages = Math.min(maxPages, MAX_PAGES_CAP);

    const makeOpts = async (overrides = {}) => ({
        proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
        origin: config.origin,
        referer: config.referer,
        mobile: false,
        ...overrides,
    });

    while (saved < resultsWanted && page < safeMaxPages && (total === null || offset < total)) {
        const payload = buildSearchPayload({ keyword: normalizedKeyword, offset, limit });
        let listData = null;
        let listError = null;
        const listUrlCandidates = dedupeStrings([config.jobsUrl, ...(config.jobsUrlCandidates || [])]);

        for (const listUrl of listUrlCandidates) {
            try {
                const baseOpts = await makeOpts({ method: 'POST', body: payload, retries: LIST_REQUEST_RETRIES });
                const data = await fetchJson(listUrl, baseOpts);
                if (data && Array.isArray(data.jobPostings)) {
                    listData = data;
                    if (listUrl !== config.jobsUrl) {
                        config.jobsUrl = listUrl;
                        config.jobsApiBase = listUrl.replace(/\/jobs$/, '');
                    }
                    break;
                }
                listError = new Error(`Unexpected payload structure from ${listUrl}`);
                if (offset === 0 && page === 0) { log.warning(`[Workday] Bad format at ${listUrl}, trying next…`); continue; }
                break;
            } catch (err) {
                listError = err;
                if (offset === 0 && page === 0) { log.warning(`[Workday] Failed at ${listUrl}: ${err.message}, trying next…`); continue; }
                break;
            }
        }

        if (!listData) {
            log.error(`[Workday] All API candidates failed at offset=${offset}: ${listError?.message}`);
            break;
        }

        if (typeof listData.total === 'number' && listData.total > 0) total = listData.total;
        else if (typeof listData.totalCount === 'number' && listData.totalCount > 0) total = listData.totalCount;

        const jobs = listData.jobPostings;
        if (!jobs.length) break;
        log.info(`[Workday] Page ${page + 1}: got ${jobs.length} listings (total: ${total ?? '?'})`);

        // Filter candidates
        const candidates = [];
        for (const job of jobs) {
            if (saved + candidates.length >= resultsWanted) break;
            const jobPostingInfo = job.jobPostingInfo || {};
            if (normalizedKeyword && keywordPhrase) {
                const normalizedTitle = normalizeForMatch(job.title);
                if (!normalizedTitle) continue;
                const hasPhrase = normalizedTitle.includes(keywordPhrase);
                const hasAll = keywordTokens.every((t) => normalizedTitle.includes(t));
                if (!hasPhrase && !hasAll) continue;
            }
            if (!shouldIncludeByPostedWithin({ job, jobPostingInfo, maxAgeDays: postedWindowDays })) continue;
            const { jobApiUrl, jobPublicUrl, postingId } = deriveJobUrls({ requestUrl: config.jobsUrl, meta: config, job });
            const dedupeKey = postingId || jobPublicUrl || jobApiUrl;
            if (dedupeKey) { if (seen.has(dedupeKey)) continue; seen.add(dedupeKey); }
            candidates.push({ job, jobPostingInfo, jobApiUrl, jobPublicUrl, postingId });
        }

        // Fetch details concurrently
        for (let i = 0; i < candidates.length && saved < resultsWanted; i += DETAIL_CONCURRENCY) {
            const chunk = candidates.slice(i, i + Math.min(DETAIL_CONCURRENCY, resultsWanted - saved));
            const records = await Promise.all(chunk.map(async ({ job, jobPostingInfo, jobApiUrl, jobPublicUrl, postingId }) => {
                let detailPayload = null;
                if (jobApiUrl) {
                    try {
                        detailPayload = await fetchJson(jobApiUrl, await makeOpts({ retries: DETAIL_REQUEST_RETRIES }));
                    } catch (err) { log.warning(`[Workday] Detail failed for ${jobApiUrl}: ${err.message}`); }
                }

                const detailInfo = detailPayload?.jobPostingInfo
                    ? { ...jobPostingInfo, ...detailPayload.jobPostingInfo }
                    : jobPostingInfo;
                const hiringOrg = detailPayload?.hiringOrganization || null;
                const locationResolved = resolveLocation({ job, detailInfo });

                if (!shouldIncludeByLocation({
                    locationNeedles,
                    allowUnknown: true,
                    locationValues: [
                        job.locationsText,
                        typeof job.location === 'string' ? job.location : job.location?.descriptor,
                        typeof jobPostingInfo.location === 'string' ? jobPostingInfo.location : jobPostingInfo.location?.descriptor,
                        detailInfo.country?.descriptor,
                        locationResolved.city, locationResolved.state, locationResolved.country,
                    ],
                })) return null;

                const descriptionHtml = detailInfo.jobDescription || '';
                const postedIso = extractIsoDate(detailInfo.startDate || detailInfo.postedOn || job.postedOn);

                return pruneEmpty({
                    job_id: postingId,
                    title: job.title,
                    company: detailInfo.company || hiringOrg?.name || config.tenant,
                    location: job.locationsText || job.location || null,
                    city: locationResolved.city,
                    state: locationResolved.state,
                    country: locationResolved.country,
                    department: detailInfo.department || hiringOrg?.name || null,
                    job_type: detailInfo.timeType || null,
                    job_family: detailInfo.jobFamily?.descriptor || detailInfo.jobFamily || null,
                    date_posted: postedIso,
                    url: jobPublicUrl || jobApiUrl,
                    apply_url: detailInfo.externalUrl || job.externalUrl || jobPublicUrl || null,
                    description: cleanText(descriptionHtml) || null,
                    remote: job.remoteEligible || detailInfo.remoteType || null,
                    salary: detailInfo.compensation || jobPostingInfo.compensation || null,
                    platform: 'workday',
                });
            }));

            const valid = records.filter(Boolean);
            allRecords.push(...valid);
            saved += valid.length;
            log.info(`[Workday] Saved ${saved} records so far`);
        }

        const responseLimit = Number(listData.pageSize || listData.limit || limit || DEFAULT_PAGE_LIMIT);
        const safeLimit = Number.isFinite(responseLimit) && responseLimit > 0 ? responseLimit : DEFAULT_PAGE_LIMIT;
        if (total === null && jobs.length < safeLimit) break;
        offset += safeLimit;
        limit = safeLimit;
        page++;
    }

    log.info(`[Workday] Done — ${allRecords.length} jobs collected`);
    return allRecords;
}
