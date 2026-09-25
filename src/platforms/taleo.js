import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';

import { fetchHtml, fetchJson, fetchXml, parseDate } from '../utils/http.js';

const parseRssJobs = (rssXml, slug) => {
    const $ = cheerioLoad(rssXml || '', { xmlMode: true });
    const jobs = [];

    $('item').each((_, item) => {
        const title = $(item).find('title').first().text().trim();
        const url = $(item).find('link').first().text().trim();
        const description = $(item).find('description').first().text().trim();
        const pubDate = $(item).find('pubDate').first().text().trim();
        const guid = $(item).find('guid').first().text().trim();
        if (/unable to create an rss feed/i.test(title)) return;

        const jobId = url.match(/[?&]job=([^&]+)/i)?.[1] || guid || undefined;
        jobs.push({
            job_id: jobId,
            title,
            company: slug,
            description: description || undefined,
            date_posted: parseDate(pubDate),
            url: url || undefined,
            apply_url: url || undefined,
            platform: 'taleo',
            ats_family: 'taleo',
        });
    });

    return jobs;
};

const buildFeedCandidates = ({ host, portal }) => {
    const candidates = [`https://${host}/careersection/feed/joblist.rss?lang=en&locale=en`];
    if (portal) {
        const portalParam = `portal=${encodeURIComponent(portal)}`;
        candidates.push(`https://${host}/careersection/feed/joblist.rss?lang=en&locale=en&${portalParam}`);
        candidates.push(`https://${host}/careersection/feed/joblist.rss?lang=en&locale=en&searchtype=2&${portalParam}`);
    }
    return [...new Set(candidates)];
};

const getBoardMetadata = async (boardUrl, proxyUrl) => {
    const response = await fetchHtml(boardUrl, { proxyUrl, retries: 2 });
    const pageHtml = String(response.body || '');
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Career section returned HTTP ${response.statusCode}`);
    }

    const queryString = pageHtml.match(/queryString\s*:\s*['"]([^'"]+)['"]/i)?.[1]
        ?.replace(/&amp;/gi, '&');
    const pageParams = new URL(boardUrl).searchParams;
    const portal = (queryString && new URLSearchParams(queryString).get('portal'))
        || pageParams.get('portal');
    if (!portal) throw new Error('Career section page did not expose its public portal ID');

    const $ = cheerioLoad(pageHtml);
    const ignoredHeaders = /^(?:icons?|actions?|select|)$/i;
    const columns = $('#jobs thead th').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((name) => !ignoredHeaders.test(name));

    const locale = pageParams.get('lang') || 'en';
    return { portal, columns, locale };
};

const toColumnText = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(toColumnText).filter(Boolean).join('; ');
    if (typeof value === 'object') return toColumnText(value.value ?? value.label ?? value.name ?? value.text ?? '');
    if (typeof value !== 'string') return String(value);

    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            return toColumnText(JSON.parse(trimmed));
        } catch {
            // Keep the source value when it only resembles serialized JSON.
        }
    }
    return trimmed;
};

const parseSearchJobs = (data, { host, section, locale, columns, slug }) => {
    if (!Array.isArray(data?.requisitionList)) return null;

    return data.requisitionList.map((requisition) => {
        const values = Array.isArray(requisition.column) ? requisition.column : [];
        const headersAlign = columns.length === values.length;
        const columnValue = (pattern) => {
            if (!headersAlign) return null;
            const index = columns.findIndex((header) => pattern.test(header));
            return index >= 0 ? toColumnText(values[index]) || null : null;
        };

        const linkedIndex = Number(requisition.linkedColumn);
        const title = columnValue(/(?:requisition\s+)?(?:job\s+)?title|position\s+title/i)
            || (Number.isInteger(linkedIndex) ? toColumnText(values[linkedIndex]) : null);
        const locationIndices = Array.isArray(requisition.locationsColumns)
            ? requisition.locationsColumns.map(Number).filter(Number.isInteger)
            : [];
        const location = locationIndices.map((index) => toColumnText(values[index])).filter(Boolean).join('; ')
            || columnValue(/(?:work\s+)?location/i);
        const requisitionId = requisition.contestNo || requisition.jobId;
        const jobUrl = requisitionId
            ? `https://${host}/careersection/${encodeURIComponent(section)}/jobdetail.ftl?job=${encodeURIComponent(requisitionId)}&lang=${encodeURIComponent(locale)}`
            : null;

        return {
            job_id: requisition.jobId || requisition.contestNo || null,
            title: title || null,
            company: slug,
            location: location || null,
            department: columnValue(/department|job\s+field|job\s+category|function/i),
            job_type: columnValue(/employment\s+type|job\s+schedule|appointment\s+type|position\s+type/i),
            date_posted: parseDate(columnValue(/posting\s+date|date\s+posted|posted\s+date/i)),
            url: jobUrl,
            apply_url: jobUrl,
            description: toColumnText(requisition.description || requisition.jobDescription) || undefined,
            platform: 'taleo',
            ats_family: 'taleo',
        };
    }).filter((job) => job.title && job.url);
};

const scrapeJsonBoard = async ({ parsed, slug, section, resultsWanted, maxPages, proxyUrl }) => {
    const searchPath = `/careersection/rest/jobboard/searchjobs`;
    const initialSearchUrl = new URL(searchPath, parsed.origin);
    const requestedLocale = parsed.searchParams.get('lang') || 'en';
    const boardPageUrl = new URL(`/careersection/${encodeURIComponent(section)}/jobsearch.ftl?lang=${encodeURIComponent(requestedLocale)}`, parsed.origin);
    if (parsed.searchParams.has('portal')) boardPageUrl.searchParams.set('portal', parsed.searchParams.get('portal'));
    const { portal, columns, locale } = await getBoardMetadata(boardPageUrl.toString(), proxyUrl);
    initialSearchUrl.searchParams.set('lang', locale);
    initialSearchUrl.searchParams.set('portal', portal);

    const jobs = [];
    const pageLimit = Math.max(1, Math.trunc(Number(maxPages) || 5));
    for (let pageNo = 1; pageNo <= pageLimit; pageNo++) {
        let data;
        try {
            data = await fetchJson(initialSearchUrl.toString(), {
                proxyUrl,
                method: 'POST',
                body: {
                    multilineEnabled: false,
                    pageNo,
                    sortingSelection: { sortBySelectionParam: '3', ascendingSortingOrder: 'false' },
                },
                headers: { 'X-Requested-With': 'XMLHttpRequest', tz: 'GMT+00:00', tzname: 'UTC' },
                origin: parsed.origin,
                referer: boardPageUrl.toString(),
            });
        } catch (err) {
            if (!jobs.length) throw err;
            log.warning(`[Taleo] Page ${pageNo} failed; keeping ${jobs.length} jobs already fetched: ${err.message}`);
            break;
        }

        const pageJobs = parseSearchJobs(data, { host: parsed.host, section, locale, columns, slug });
        if (!pageJobs) {
            if (!jobs.length) throw new Error('Taleo job-board endpoint returned an unexpected response');
            log.warning(`[Taleo] Page ${pageNo} returned an unexpected response; keeping ${jobs.length} jobs already fetched.`);
            break;
        }

        jobs.push(...pageJobs);
        log.info(`[Taleo] Page ${pageNo}: received ${pageJobs.length} jobs (total: ${jobs.length}/${data.pagingData?.totalCount ?? '?'})`);

        const totalCount = Number(data.pagingData?.totalCount);
        if (!pageJobs.length || (Number.isFinite(totalCount) && totalCount > 0 && jobs.length >= totalCount)) break;
        if (resultsWanted && jobs.length >= resultsWanted) break;
    }
    return resultsWanted ? jobs.slice(0, resultsWanted) : jobs;
};

/** Read Taleo's public JSON job-board endpoint, using the career page only to discover its portal ID and column labels. */
export async function scrape({ rawUrl, slug, section }, { resultsWanted = 20, maxPages = 5, proxyUrl } = {}) {
    const parsed = rawUrl ? new URL(rawUrl) : new URL(`https://${slug}.taleo.net/careersection/${section || 'ext'}/jobsearch.ftl?lang=en`);
    try {
        const jobs = await scrapeJsonBoard({ parsed, slug, section: section || 'ext', resultsWanted, maxPages, proxyUrl });
        log.info(`[Taleo] Collected ${jobs.length} jobs from the public JSON job-board endpoint.`);
        return jobs;
    } catch (err) {
        log.warning(`[Taleo] JSON job-board request failed for ${parsed.host}: ${err.message}; trying public RSS feeds.`);
    }

    let portal = parsed.searchParams.get('portal');
    if (!portal) {
        try {
            const boardPageUrl = new URL(`/careersection/${encodeURIComponent(section || 'ext')}/jobsearch.ftl?lang=${encodeURIComponent(parsed.searchParams.get('lang') || 'en')}`, parsed.origin);
            ({ portal } = await getBoardMetadata(boardPageUrl.toString(), proxyUrl));
        } catch (err) {
            log.debug(`[Taleo] Could not read portal ID for RSS fallback: ${err.message}`);
        }
    }
    const feedCandidates = buildFeedCandidates({ host: parsed.host, portal });
    log.info(`[Taleo] Trying ${feedCandidates.length} RSS feed endpoints for ${parsed.host}`);

    for (const feedUrl of feedCandidates) {
        try {
            const response = await fetchXml(feedUrl, { proxyUrl, origin: `https://${parsed.host}`, referer: `https://${parsed.host}/`, retries: 2 });
            if (response.statusCode < 200 || response.statusCode >= 300) continue;

            const xml = String(response.body || '');
            const jobs = parseRssJobs(xml, slug);
            if (jobs.length) {
                log.info(`[Taleo] Parsed ${jobs.length} jobs from the public RSS feed.`);
                return resultsWanted ? jobs.slice(0, resultsWanted) : jobs;
            }
            if (/unable to create an rss feed/i.test(xml)) {
                log.warning(`[Taleo] RSS is unavailable or not enabled for ${parsed.host}.`);
            }
        } catch (err) {
            log.debug(`[Taleo] RSS feed request failed (${feedUrl}): ${err.message}`);
        }
    }

    log.warning(`[Taleo] No usable public RSS listings were available for ${parsed.host}.`);
    return [];
}
