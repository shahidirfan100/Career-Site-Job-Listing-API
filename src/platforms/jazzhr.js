import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from JazzHR.
 * API: https://{slug}.jazz.co/api/recruiting/jobs
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const url = `https://${slug}.jazz.co/api/recruiting/jobs`;
    log.info(`[JazzHR] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, { proxyUrl });
    } catch (err) {
        log.error(`[JazzHR] API failed for ${slug}: ${err.message}`);
        return [];
    }

    const jobs = Array.isArray(data) ? data : (data?.jobs ?? []);
    log.info(`[JazzHR] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => cleanObj({
        job_id: j.board_code || j.id || null,
        title: j.title || null,
        company: slug,
        location: [j.city, j.state, j.country].filter(Boolean).join(', ') || null,
        city: j.city || null,
        state: j.state || null,
        country: j.country || null,
        department: j.department || null,
        job_type: j.type || null,
        date_posted: parseDate(j.original_open_date),
        url: j.board_code_url || `https://${slug}.jazz.co/apply/${j.board_code}`,
        apply_url: j.apply_url || null,
        description: stripHtml(j.description || j.job_description || j.content),
        platform: 'jazzhr',
    }));
}
