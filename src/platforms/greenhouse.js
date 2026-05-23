import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

/**
 * Scrape jobs from Greenhouse API.
 * API: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 * Response: { jobs: [...], meta: { total: N } }
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    log.info(`[Greenhouse] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, { proxyUrl });
    } catch (err) {
        log.error(`[Greenhouse] API request failed for ${slug}: ${err.message}`);
        return [];
    }

    const jobs = data?.jobs ?? data?.results ?? [];
    if (!Array.isArray(jobs)) {
        log.warning(`[Greenhouse] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[Greenhouse] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => cleanObj({
        job_id: j.id || j.internal_job_id || null,
        title: j.title || null,
        company: j.company_name || slug,
        location: j.location?.name || null,
        city: j.location?.city || null,
        country: j.location?.country || null,
        department: j.departments?.[0]?.name || null,
        offices: j.offices?.map((o) => o.name).filter(Boolean) || null,
        job_type: null,
        date_posted: parseDate(j.first_published || j.updated_at),
        updated_at: parseDate(j.updated_at),
        url: j.absolute_url || null,
        apply_url: j.absolute_url || null,
        description: j.content || null,
        platform: 'greenhouse',
    }));
}
