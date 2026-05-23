import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from TeamTailor via their public JSON API.
 * Endpoint: https://{slug}.teamtailor.com/jobs.json  (or /api/jobs.json)
 * Falls back to the paginated REST API format used by some sites.
 */
export async function scrape({ slug, rawUrl }, { resultsWanted, proxyUrl } = {}) {
    const base = rawUrl
        ? new URL(rawUrl).origin
        : `https://${slug}.teamtailor.com`;

    log.info(`[TeamTailor] Fetching jobs for: ${base}`);

    // Try candidate API endpoints in order
    const endpoints = [
        `${base}/jobs.json`,
        `${base}/api/jobs.json`,
        `${base}/en/jobs.json`,
    ];

    let jobs = null;
    for (const url of endpoints) {
        try {
            const data = await fetchJson(url, {
                proxyUrl,
                headers: {
                    'Accept': 'application/json',
                    'Referer': base,
                },
            });
            // Response may be array or { jobs: [...] } or { data: [...] }
            const arr = Array.isArray(data) ? data : (data?.jobs ?? data?.data ?? null);
            if (Array.isArray(arr) && arr.length >= 0) {
                jobs = arr;
                log.info(`[TeamTailor] Found ${jobs.length} jobs via ${url}`);
                break;
            }
        } catch (err) {
            log.debug(`[TeamTailor] ${url} failed: ${err.message}`);
        }
    }

    if (!jobs) {
        log.error(`[TeamTailor] Could not fetch jobs for ${slug}. All API endpoints failed.`);
        return [];
    }

    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => {
        // TeamTailor JSON API wraps attributes in j.attributes
        const attr = j.attributes ?? j;
        const jobId = j.id ?? attr.id;
        return cleanObj({
            job_id: jobId || null,
            title: attr.title || attr.name || null,
            company: slug,
            location: attr.location || attr.city || null,
            city: attr.city || null,
            country: attr.country || null,
            department: null,
            workplace_type: attr.remote_status || null,
            job_type: attr['employment-type'] || attr.employment_type || null,
            date_posted: parseDate(attr['created-at'] || attr.created_at),
            updated_at: parseDate(attr['updated-at'] || attr.updated_at || attr['created-at'] || attr.created_at),
            url: attr['career-page-url'] || (jobId ? `${base}/jobs/${jobId}` : null),
            apply_url: attr['apply-url'] || null,
            description: stripHtml(
                attr.body
                || attr.description
                || attr['job-description']
                || attr.pitch,
            ),
            remote: attr.remote === true ? true : undefined,
            platform: 'teamtailor',
        });
    });
}
