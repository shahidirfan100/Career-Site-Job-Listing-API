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

const parseSearchEmbeddedJobs = (html) => {
    const jobs = [];
    const seen = new Set();
    const re = /Submission for the position:\s*([^']+?)\s*-\s*\(Job Number:\s*(\d+)\)/g;
    let match;
    while ((match = re.exec(html)) !== null) {
        const title = (match[1] || '').replace(/%26/g, '&').replace(/\s+/g, ' ').trim();
        const jobNumber = (match[2] || '').trim();
        if (!jobNumber || seen.has(jobNumber)) continue;
        seen.add(jobNumber);
        jobs.push({ title, jobNumber });
    }
    return jobs;
};

const extractDetailFromHtml = (html) => {
    const text = cheerioLoad(html).root().text().replace(/\s+/g, ' ').trim();
    const location = text.match(/Primary Location\s+(.+?)\s+NATO Body/i)?.[1]?.trim()
        || text.match(/Primary Location\s+(.+?)\s+Schedule/i)?.[1]?.trim()
        || undefined;
    const deadline = text.match(/Application Deadline\s+(.+?)\s+Salary/i)?.[1]?.trim()
        || text.match(/Application Deadline\s+(.+?)\s+Description/i)?.[1]?.trim()
        || undefined;
    const description = text.match(/Description\s*:?\s+(.+?)\s+(YOUR QUALIFICATIONS|HOW TO APPLY|CONTRACT|SALARY\/BENEFITS)/i)?.[1]?.trim()
        || undefined;
    return {
        location,
        date_posted: toIsoDate(deadline),
        description,
    };
};

const scrapeFromSearchPageFallback = async ({ host, section, slug, rawUrl, proxyUrl, resultsWanted }) => {
    const searchUrl = rawUrl || `https://${host}/careersection/${section || '2'}/jobsearch.ftl?lang=en`;
    const searchResp = await gotScraping({
        url: searchUrl,
        proxyUrl,
        responseType: 'text',
        throwHttpErrors: false,
        timeout: { request: 30_000 },
    });
    if ((searchResp.statusCode || 0) >= 400) return [];

    const searchHtml = String(searchResp.body || '');
    const embedded = parseSearchEmbeddedJobs(searchHtml).slice(0, resultsWanted || 20);
    const jobs = [];

    for (const item of embedded) {
        const detailUrl = `https://${host}/careersection/${section || '2'}/jobdetail.ftl?job=${item.jobNumber}&lang=en`;
        let detail = {};
        try {
            const detailResp = await gotScraping({
                url: detailUrl,
                proxyUrl,
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 30_000 },
            });
            if ((detailResp.statusCode || 0) < 400) {
                detail = extractDetailFromHtml(String(detailResp.body || ''));
            }
        } catch (err) {
            log.debug(`[Taleo] Detail fallback failed for ${detailUrl}: ${err.message}`);
        }

        jobs.push({
            job_id: item.jobNumber,
            title: item.title || `Job ${item.jobNumber}`,
            company: slug,
            url: detailUrl,
            apply_url: detailUrl,
            platform: 'taleo',
            ats_family: 'taleo',
            ...detail,
        });
    }

    return jobs;
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

    if (!limitedJobs.length) {
        log.warning(`[Taleo] RSS feed returned no usable jobs. Trying search-page embedded data fallback.`);
        const fallbackJobs = await scrapeFromSearchPageFallback({
            host: parsed.host,
            section,
            slug,
            rawUrl,
            proxyUrl,
            resultsWanted,
        });
        if (fallbackJobs.length) return fallbackJobs;
    }

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
