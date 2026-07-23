import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from BambooHR.
 * API: https://{slug}.bamboohr.com/careers/list
 * Response: { result: [...] }
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const url = `https://${slug}.bamboohr.com/careers/list`;
    log.info(`[BambooHR] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, {
            proxyUrl,
            origin: `https://${slug}.bamboohr.com`,
            referer: `https://${slug}.bamboohr.com/careers`,
        });
    } catch (err) {
        log.error(`[BambooHR] API failed for ${slug}: ${err.message}`);
        return [];
    }

    const jobs = data?.result ?? data?.jobs ?? data?.data ?? [];
    if (!Array.isArray(jobs)) {
        log.warning(`[BambooHR] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[BambooHR] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => cleanObj({
        job_id: j.id || j.jobId || null,
        title: j.jobOpeningName || j.title || j.name || null,
        company: slug,
        location: j.location?.city
            ? [j.location.city, j.location.state].filter(Boolean).join(', ')
            : (j.location || null),
        city: j.location?.city || null,
        state: j.location?.state || null,
        country: j.location?.country || null,
        department: j.departmentLabel || j.department?.label || null,
        job_type: j.employmentStatusLabel || null,
        date_posted: parseDate(j.datePosted || j.created),
        url: `https://${slug}.bamboohr.com/careers/${j.id}`,
        apply_url: `https://${slug}.bamboohr.com/careers/${j.id}/apply`,
        description: stripHtml(j.description || j.jobDescription || j.jobOpeningDescription),
        remote: j.isRemote === '1' || j.isRemote === true ? true : undefined,
        platform: 'bamboohr',
    }));
}
