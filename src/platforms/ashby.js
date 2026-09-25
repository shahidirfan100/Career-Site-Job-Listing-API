import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

/**
 * Scrape jobs from Ashby API.
 * API: https://api.ashbyhq.com/posting-api/job-board/{slug}
 * Response: { jobs: [...], apiVersion: "1" }
 */
export async function scrape({ slug, prefetchedData }, { resultsWanted, proxyUrl } = {}) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    log.info(`[Ashby] Fetching jobs for company: ${slug}`);

    let data = prefetchedData;
    if (data === undefined) {
        try {
            data = await fetchJson(url, { proxyUrl, origin: 'https://api.ashbyhq.com', referer: `https://jobs.ashbyhq.com/${slug}` });
        } catch (err) {
            log.error(`[Ashby] API request failed for ${slug}: ${err.message}`);
            return [];
        }
    }

    const jobs = data?.jobs ?? [];
    if (!Array.isArray(jobs)) {
        log.warning(`[Ashby] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[Ashby] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => cleanObj({
        job_id: j.id || j.jobId || j.requisitionId || null,
        title: j.title || null,
        company: j.company || slug,
        location: j.locationName || j.location || null,
        department: j.teamName || j.department || null,
        team: j.teamName || null,
        workplace_type: j.workplaceType || null,
        job_type: j.employmentType || null,
        date_posted: parseDate(j.publishedDate || j.updatedAt),
        updated_at: parseDate(j.updatedAt),
        url: j.jobUrl || j.hostedUrl || null,
        apply_url: j.applyUrl || j.jobUrl || null,
        description: j.descriptionHtml ? j.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null,
        remote: j.isRemote === true ? true : undefined,
        platform: 'ashby',
    }));
}
