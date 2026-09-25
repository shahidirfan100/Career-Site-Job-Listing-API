import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from BambooHR.
 * The public list endpoint returns sparse summaries; the public detail endpoint
 * includes the description and additional fields for each requested listing.
 */
export async function scrape({ slug, prefetchedData }, { resultsWanted, proxyUrl } = {}) {
    const baseUrl = `https://${slug}.bamboohr.com`;
    const url = `${baseUrl}/careers/list`;
    log.info(`[BambooHR] Fetching jobs for company: ${slug}`);

    let data = prefetchedData;
    if (data === undefined) {
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
    }

    const jobs = data?.result ?? data?.jobs ?? data?.data ?? [];
    if (!Array.isArray(jobs)) {
        log.warning(`[BambooHR] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[BambooHR] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;
    const enriched = new Array(limited.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(4, limited.length) }, async () => {
        while (nextIndex < limited.length) {
            const index = nextIndex++;
            const summary = limited[index];
            let detail = {};

            // Page-discovered records may come from a custom careers URL. Only
            // make tenant detail calls when the direct BambooHR list API was used.
            if (summary.id && prefetchedData === undefined) {
                try {
                    const detailResponse = await fetchJson(
                        `${baseUrl}/careers/${encodeURIComponent(summary.id)}/detail`,
                        { proxyUrl, origin: baseUrl, referer: `${baseUrl}/careers/` },
                    );
                    detail = detailResponse?.result?.jobOpening || detailResponse?.jobOpening || {};
                } catch (err) {
                    log.debug(`[BambooHR] Detail request failed for job ${summary.id}: ${err.message}`);
                }
            }

            const job = { ...summary, ...detail };
            const location = job.location || {};
            const atsLocation = job.atsLocation || {};
            const city = location.city || atsLocation.city || null;
            const state = location.state || atsLocation.state || atsLocation.province || null;
            const country = location.addressCountry || atsLocation.country || null;
            const id = job.id || job.jobId || null;

            enriched[index] = cleanObj({
                job_id: id,
                title: job.jobOpeningName || job.title || job.name || null,
                company: slug,
                location: city
                    ? [city, state].filter(Boolean).join(', ')
                    : (location.name || [state, country].filter(Boolean).join(', ') || null),
                city,
                state,
                country,
                department: job.departmentLabel || job.department?.label || null,
                job_type: job.employmentStatusLabel || null,
                date_posted: parseDate(job.datePosted || job.created),
                url: job.jobOpeningShareUrl || `https://${slug}.bamboohr.com/careers/${id}`,
                apply_url: job.jobOpeningShareUrl || `https://${slug}.bamboohr.com/careers/${id}/apply`,
                description: stripHtml(job.description || job.jobDescription || job.jobOpeningDescription),
                remote: job.isRemote === '1' || job.isRemote === true ? true : undefined,
                platform: 'bamboohr',
            });
        }
    });

    await Promise.all(workers);
    return enriched;
}
