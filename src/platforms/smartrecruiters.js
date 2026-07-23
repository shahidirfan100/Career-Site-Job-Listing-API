import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const buildSmartRecruitersDescription = (detail) => {
    const sections = detail?.jobAd?.sections;
    if (!sections || typeof sections !== 'object') return null;
    const orderedKeys = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription'];
    const chunks = [];
    for (const key of orderedKeys) {
        const text = stripHtml(sections?.[key]?.text);
        if (text) chunks.push(text);
    }
    if (!chunks.length) {
        for (const section of Object.values(sections)) {
            const text = stripHtml(section?.text);
            if (text) chunks.push(text);
        }
    }
    return chunks.length ? chunks.join('\n\n') : null;
};

/**
 * Scrape jobs from SmartRecruiters API.
 * API: https://api.smartrecruiters.com/v1/companies/{slug}/postings
 * Response: { content: [...], totalFound: N, offset: 0, limit: 100 }
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const PAGE_SIZE = 100;
    const allJobs = [];
    let offset = 0;
    let totalFound = Infinity;

    log.info(`[SmartRecruiters] Fetching jobs for company: ${slug}`);

    const sharedOpts = { proxyUrl, origin: 'https://api.smartrecruiters.com', referer: `https://careers.smartrecruiters.com/${slug}/` };

    while (allJobs.length < (resultsWanted || Infinity) && offset < totalFound) {
        const limit = Math.min(PAGE_SIZE, resultsWanted ? resultsWanted - allJobs.length : PAGE_SIZE);
        const url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${limit}&offset=${offset}`;

        let data;
        try {
            data = await fetchJson(url, sharedOpts);
        } catch (err) {
            log.error(`[SmartRecruiters] API failed at offset ${offset} for ${slug}: ${err.message}`);
            break;
        }

        const jobs = data?.content ?? [];
        totalFound = data?.totalFound ?? 0;

        if (!jobs.length) break;

        // Fetch details concurrently
        const postingIds = jobs.filter((j) => j.id).map((j) => j.id);
        const detailMap = {};
        if (postingIds.length) {
            const detailResults = await Promise.allSettled(
                postingIds.map((id) =>
                    fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${id}`, sharedOpts)
                        .catch((err) => {
                            log.debug(`[SmartRecruiters] Detail failed for posting ${id}: ${err.message}`);
                            return null;
                        }),
                ),
            );
            detailResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value) {
                    detailMap[postingIds[idx]] = result.value;
                }
            });
        }

        for (const j of jobs) {
            const detail = detailMap[j.id] || null;

            allJobs.push(cleanObj({
                job_id: j.id || null,
                title: j.name || null,
                company: j.company?.name || slug,
                location: j.location?.fullLocation || j.location?.city || null,
                city: j.location?.city || null,
                state: j.location?.region || null,
                country: j.location?.country || null,
                department: j.department?.label || null,
                category: j.department?.id || null,
                job_type: j.typeOfEmployment?.label || null,
                workplace_type: j.location?.remote ? 'remote' : 'on-site',
                date_posted: parseDate(j.releasedDate),
                updated_at: parseDate(j.updatedDate || j.releasedDate),
                url: `https://careers.smartrecruiters.com/${slug}/${j.id}`,
                apply_url: detail?.applyUrl || j.ref || null,
                description: buildSmartRecruitersDescription(detail),
                remote: j.location?.remote === true ? true : undefined,
                platform: 'smartrecruiters',
            }));
        }

        offset += jobs.length;
        log.info(`[SmartRecruiters] Fetched ${allJobs.length}/${totalFound} jobs`);

        if (resultsWanted && allJobs.length >= resultsWanted) break;
    }

    return allJobs;
}
