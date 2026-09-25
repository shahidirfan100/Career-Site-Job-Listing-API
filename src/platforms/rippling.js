import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const labelOf = (value) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    return value.label || value.name || value.value || null;
};

const locationOf = (value) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    return value.label || value.name || [value.city, value.region, value.state, value.country].filter(Boolean).join(', ') || null;
};

/**
 * Read Rippling's public, company-scoped ATS board endpoint.
 */
export async function scrape({ slug, prefetchedData }, { resultsWanted, proxyUrl } = {}) {
    let data = prefetchedData;
    if (data === undefined) {
        const url = `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`;
        try {
            data = await fetchJson(url, {
                proxyUrl,
                origin: 'https://ats.rippling.com',
                referer: `https://ats.rippling.com/${encodeURIComponent(slug)}/jobs`,
            });
        } catch (err) {
            log.warning(`[Rippling] Public board request failed for ${slug}: ${err.message}`);
            return [];
        }
    }

    const postings = Array.isArray(data) ? data : data?.jobs ?? data?.data ?? data?.results;
    if (!Array.isArray(postings)) {
        log.warning(`[Rippling] Unexpected board response for ${slug}.`);
        return [];
    }

    const limited = resultsWanted ? postings.slice(0, resultsWanted) : postings;
    return limited.map((posting) => {
        const location = locationOf(posting.workLocation || posting.location);
        return cleanObj({
            job_id: posting.uuid || posting.id || posting.jobId || null,
            title: posting.name || posting.title || null,
            company: posting.company?.name || posting.companyName || slug,
            location,
            city: posting.location?.city || null,
            state: posting.location?.region || posting.location?.state || null,
            country: posting.location?.country || null,
            department: labelOf(posting.department),
            team: labelOf(posting.team),
            job_type: labelOf(posting.employmentType || posting.employment_type),
            workplace_type: labelOf(posting.workplaceType || posting.workplace_type),
            remote: /remote/i.test(location || '') ? true : undefined,
            date_posted: parseDate(posting.publishedAt || posting.createdAt || posting.datePosted),
            updated_at: parseDate(posting.updatedAt || posting.publishedAt || posting.createdAt),
            url: posting.url || posting.jobUrl || posting.publicUrl || null,
            apply_url: posting.applyUrl || posting.applicationUrl || posting.url || null,
            description: posting.description || posting.jobDescription || null,
            platform: 'rippling',
        });
    });
}
