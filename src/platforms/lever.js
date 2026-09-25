import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

/**
 * Scrape jobs from Lever API.
 * API: https://api.lever.co/v0/postings/{slug}?mode=json
 * Returns all jobs in a single call (no pagination needed).
 */
export async function scrape({ slug, isEU = false, prefetchedData }, { resultsWanted, proxyUrl } = {}) {
    const base = isEU ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    const url = `${base}/v0/postings/${slug}?mode=json`;

    log.info(`[Lever] Fetching jobs for company: ${slug}`);

    let postings = prefetchedData;
    if (postings === undefined) {
        try {
            postings = await fetchJson(url, { proxyUrl, origin: 'https://jobs.lever.co', referer: `https://jobs.lever.co/${slug}` });
        } catch (err) {
            log.error(`[Lever] API request failed for ${slug}: ${err.message}`);
            return [];
        }
    }

    if (!Array.isArray(postings)) {
        log.warning(`[Lever] Unexpected response shape. Keys: ${Object.keys(postings || {}).join(', ')}`);
        return [];
    }

    log.info(`[Lever] Found ${postings.length} postings for ${slug}`);

    const limited = resultsWanted ? postings.slice(0, resultsWanted) : postings;

    return limited.map((p) => cleanObj({
        job_id: p.id || p.requisitionCode || null,
        title: p.text || null,
        company: p.company || slug,
        location: p.categories?.location || null,
        team: p.categories?.team || null,
        department: p.categories?.department || p.categories?.team || null,
        workplace_type: p.workplaceType || null,
        job_type: p.categories?.commitment || null,
        date_posted: parseDate(p.createdAt),
        updated_at: parseDate(p.updatedAt),
        url: p.hostedUrl || null,
        apply_url: p.applyUrl || null,
        description: p.descriptionPlain || null,
        remote: p.workplaceType === 'remote' ? true : undefined,
        tags: p.tags?.length ? p.tags : undefined,
        platform: 'lever',
    }));
}
