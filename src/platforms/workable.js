import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from Workable API.
 * Primary API: GET https://www.workable.com/api/accounts/{slug}?details=true
 * Fallback API: POST https://apply.workable.com/api/v3/accounts/{slug}/jobs
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    log.info(`[Workable] Fetching jobs for company: ${slug}`);

    try {
        const account = await fetchJson(`https://www.workable.com/api/accounts/${slug}?details=true`, {
            proxyUrl,
            origin: 'https://www.workable.com',
            referer: `https://apply.workable.com/${slug}/`,
        });
        const jobs = Array.isArray(account?.jobs) ? account.jobs : [];
        if (jobs.length) {
            const mapped = jobs.map((j) => cleanObj({
                job_id: j.id || j.shortcode || j.code || null,
                title: j.title || null,
                company: account?.name || slug,
                location: [j.city, j.state, j.country].filter(Boolean).join(', ') || null,
                city: j.city || null,
                state: j.state || null,
                country: j.country || null,
                department: Array.isArray(j.department) ? j.department.join(' / ') : j.department,
                job_type: j.employment_type || null,
                workplace_type: j.telecommuting ? 'remote' : null,
                date_posted: parseDate(j.published_on || j.created_at),
                updated_at: parseDate(j.updated_at || j.published_on || j.created_at),
                url: j.url || (j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/` : null),
                apply_url: j.application_url || (j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/apply/` : null),
                description: stripHtml(j.description),
                remote: j.telecommuting === true ? true : undefined,
                platform: 'workable',
            }));
            return resultsWanted ? mapped.slice(0, resultsWanted) : mapped;
        }
    } catch (err) {
        log.warning(`[Workable] Rich endpoint failed for ${slug}: ${err.message}. Falling back.`);
    }

    const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs`;
    const fallbackItems = [];
    let cursor = null;
    do {
        const body = { query: '', location: [], department: [], worktype: [], remote: [] };
        if (cursor) body.token = cursor;
        let data;
        try {
            data = await fetchJson(url, {
                method: 'POST',
                body,
                proxyUrl,
                origin: 'https://apply.workable.com',
                referer: `https://apply.workable.com/${slug}/`,
            });
        } catch (err) {
            log.error(`[Workable] Fallback API failed for ${slug}: ${err.message}`);
            break;
        }
        const jobs = data?.results ?? [];
        if (!Array.isArray(jobs) || !jobs.length) break;
        for (const j of jobs) {
            fallbackItems.push(cleanObj({
                job_id: j.id || j.shortcode || null,
                title: j.title || null,
                company: slug,
                location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') || null,
                city: j.location?.city || null,
                state: j.location?.region || null,
                country: j.location?.country || null,
                department: Array.isArray(j.department) ? j.department.join(' / ') : j.department,
                job_type: j.type || null,
                workplace_type: j.workplace || null,
                date_posted: parseDate(j.published || null),
                url: j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/` : null,
                apply_url: j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/apply/` : null,
                remote: j.remote === true ? true : undefined,
                platform: 'workable',
            }));
        }
        cursor = data?.hasMore ? (data?.cursor ?? data?.token ?? null) : null;
    } while (cursor && (!resultsWanted || fallbackItems.length < resultsWanted));

    return resultsWanted ? fallbackItems.slice(0, resultsWanted) : fallbackItems;
}
