import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const extractDescriptionFromHtml = (html) => {
    if (!html || typeof html !== 'string') return null;
    const $ = cheerioLoad(html);
    const selectors = ['[data-ui="job-description"]', '.job-description', '.description', '.position-description', 'main'];
    for (const selector of selectors) {
        const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
        if (text && text.length > 40) return text;
    }
    return null;
};

/**
 * Scrape jobs from BreezyHR.
 * API: https://{slug}.breezy.hr/json
 * Returns: array of positions directly
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl, allowHtmlDetailFallback = false } = {}) {
    const url = `https://${slug}.breezy.hr/json`;
    log.info(`[BreezyHR] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, { proxyUrl });
    } catch (err) {
        log.error(`[BreezyHR] API failed for ${slug}: ${err.message}`);
        return [];
    }

    const jobs = Array.isArray(data) ? data : (data?.positions ?? data?.jobs ?? []);
    if (!Array.isArray(jobs)) {
        log.warning(`[BreezyHR] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[BreezyHR] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    const jobsOut = limited.map((j) => cleanObj({
        job_id: j._id || j.id || j.friendly_id || null,
        title: j.name || j.title || null,
        company: j.company?.name || slug,
        location: j.location?.name || j.location || null,
        city: j.location?.city || null,
        country: j.location?.country || null,
        department: j.department?.name || j.department || null,
        job_type: j.type?.name || j.type || null,
        date_posted: parseDate(j.creation_date || j.created_at),
        url: `https://${slug}.breezy.hr/p/${j._id || j.id}-${j.friendly_id || ''}`.replace(/-$/, ''),
        apply_url: null,
        description: stripHtml(j.description || j.description_text || j.content),
        remote: j.location?.is_remote === true ? true : undefined,
        platform: 'breezyhr',
    }));

    if (!allowHtmlDetailFallback) return jobsOut;

    for (const job of jobsOut) {
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
            const extracted = extractDescriptionFromHtml(String(response.body || ''));
            if (extracted) job.description = extracted;
        } catch (err) {
            log.debug(`[BreezyHR] HTML fallback failed for ${job.url}: ${err.message}`);
        }
    }

    return jobsOut;
}
