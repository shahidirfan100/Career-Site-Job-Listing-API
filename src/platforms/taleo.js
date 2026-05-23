import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

const XML_HEADERS = {
    Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
};

const toIsoDate = (value) => {
    if (!value) return undefined;
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
};

const parseRssJobs = (rssXml, slug) => {
    const $ = cheerioLoad(rssXml || '', { xmlMode: true });
    const jobs = [];

    $('item').each((_, item) => {
        const title = $(item).find('title').first().text().trim();
        const url = $(item).find('link').first().text().trim();
        const description = $(item).find('description').first().text().trim();
        const pubDate = $(item).find('pubDate').first().text().trim();
        const guid = $(item).find('guid').first().text().trim();

        // Taleo returns a synthetic error item when RSS creation fails.
        if (/unable to create an rss feed/i.test(title)) return;

        const jobIdMatch = url.match(/[?&]job=([^&]+)/i);
        const jobId = jobIdMatch?.[1] || guid || undefined;

        jobs.push({
            job_id: jobId,
            title,
            company: slug,
            description: description || undefined,
            date_posted: toIsoDate(pubDate),
            url: url || undefined,
            apply_url: url || undefined,
            platform: 'taleo',
            ats_family: 'taleo',
        });
    });

    return jobs;
};

const extractDescriptionFromHtml = (html) => {
    if (!html || typeof html !== 'string') return undefined;
    const $ = cheerioLoad(html);
    const selectors = ['#requisitionDescriptionInterface\\.ID1515\\._id', '.requisitionDescription', '.article', 'main'];
    for (const selector of selectors) {
        const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
        if (text && text.length > 60) return text;
    }
    return undefined;
};

const buildFeedCandidates = ({ host, section }) => {
    const candidates = [];
    const sectionCandidate = section && section !== 'careersection' ? section : null;

    const common = [
        'lang=en',
        'locale=en',
    ];

    candidates.push(`https://${host}/careersection/feed/joblist.rss?${common.join('&')}`);
    if (sectionCandidate) {
        candidates.push(`https://${host}/careersection/feed/joblist.rss?${common.join('&')}&portal=${encodeURIComponent(sectionCandidate)}`);
        candidates.push(`https://${host}/careersection/feed/joblist.rss?${common.join('&')}&searchtype=2&portal=${encodeURIComponent(sectionCandidate)}`);
    }

    return [...new Set(candidates)];
};

/**
 * Scrape Taleo jobs from built-in RSS feed endpoints (API/feed-based).
 */
export async function scrape({ rawUrl, slug, section }, { resultsWanted = 20, proxyUrl, allowHtmlDetailFallback = false } = {}) {
    const parsed = rawUrl ? new URL(rawUrl) : new URL(`https://${slug}.taleo.net/careersection/${section || 'ext'}/jobsearch.ftl?lang=en`);
    const feedCandidates = buildFeedCandidates({
        host: parsed.host,
        section,
    });

    log.info(`[Taleo] Trying ${feedCandidates.length} RSS feed endpoints for ${parsed.host}`);

    let jobs = [];
    for (const feedUrl of feedCandidates) {
        try {
            const response = await gotScraping({
                url: feedUrl,
                proxyUrl,
                headers: XML_HEADERS,
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 30_000 },
            });
            if ((response.statusCode || 0) >= 400) continue;

            const rss = String(response.body || '');
            const parsedJobs = parseRssJobs(rss, slug);
            if (parsedJobs.length) {
                jobs = parsedJobs;
                log.info(`[Taleo] Parsed ${parsedJobs.length} jobs from ${feedUrl}`);
                break;
            }

            if (/unable to create an rss feed/i.test(rss)) {
                log.warning(`[Taleo] RSS exists but requires criteria setup for ${parsed.host}`);
            }
        } catch (err) {
            log.debug(`[Taleo] Feed request failed (${feedUrl}): ${err.message}`);
        }
    }

    const limitedJobs = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    if (allowHtmlDetailFallback) {
        for (const job of limitedJobs) {
            if (job.description || !job.url) continue;
            try {
                const response = await gotScraping({
                    url: job.url,
                    proxyUrl,
                    responseType: 'text',
                    throwHttpErrors: false,
                    timeout: { request: 30_000 },
                });
                if ((response.statusCode || 0) >= 400) continue;
                const description = extractDescriptionFromHtml(String(response.body || ''));
                if (description) job.description = description;
            } catch (err) {
                log.debug(`[Taleo] HTML fallback failed for ${job.url}: ${err.message}`);
            }
        }
    }

    return limitedJobs;
}
