import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => (typeof value === 'string'
    ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null
    : null);

const getRows = (data) => Array.isArray(data) ? data : data?.results ?? data?.jobs ?? data?.data;

const mapPosting = (posting, slug) => {
    const id = posting.id || posting.job_id || null;
    const hash = posting.hash || posting.slug || id;
    const jobUrl = posting.career_page_url
        || posting.url
        || (hash ? `https://www.careers-page.com/${encodeURIComponent(slug)}/job/${encodeURIComponent(hash)}` : null);

    return cleanObj({
        job_id: id,
        title: posting.position_name || posting.title || posting.name || null,
        company: posting.company_name || posting.company?.name || slug,
        location: posting.location_display || [posting.city, posting.state, posting.country].filter(Boolean).join(', '),
        city: posting.city,
        state: posting.state,
        country: posting.country,
        department: posting.organization_name || posting.department || null,
        job_type: posting.contract_details || posting.employment_type || null,
        workplace_type: posting.is_remote === true ? 'remote' : null,
        remote: posting.is_remote === true ? true : undefined,
        date_posted: parseDate(posting.published_at || posting.created_at || posting.createdAt),
        updated_at: parseDate(posting.updated_at || posting.updatedAt),
        url: jobUrl,
        apply_url: posting.apply_url || jobUrl,
        description: stripHtml(posting.description || posting.job_description),
        platform: 'manatal',
    });
};

/** Read Manatal's public career-page listing API (documented, no API key required). */
export async function scrape({ slug, clientSlug, prefetchedData }, { resultsWanted, maxPages = 5, proxyUrl } = {}) {
    const boardSlug = clientSlug || slug;
    const allPostings = [];

    if (prefetchedData !== undefined) {
        const rows = getRows(prefetchedData);
        if (!Array.isArray(rows)) {
            log.warning(`[Manatal] Embedded public data did not contain a recognized jobs list for ${boardSlug}.`);
            return [];
        }
        allPostings.push(...rows);
    } else {
        const wanted = resultsWanted ? Math.max(1, resultsWanted) : 100;
        const pageSize = Math.min(100, wanted);
        const pageCap = Math.max(1, Number(maxPages) || 5);

        for (let page = 1; page <= pageCap && allPostings.length < wanted; page++) {
            const url = `https://api.manatal.com/open/v3/career-page/${encodeURIComponent(boardSlug)}/jobs/?page=${page}&page_size=${pageSize}`;
            let data;
            try {
                data = await fetchJson(url, {
                    proxyUrl,
                    origin: 'https://careers-page.com',
                    referer: `https://www.careers-page.com/${encodeURIComponent(boardSlug)}`,
                });
            } catch (err) {
                if (page === 1) log.warning(`[Manatal] Public career-page API failed for ${boardSlug}: ${err.message}`);
                break;
            }

            const rows = getRows(data);
            if (!Array.isArray(rows) || rows.length === 0) break;
            allPostings.push(...rows);
            if (data?.next === null || rows.length < pageSize) break;
        }
    }

    return allPostings.slice(0, resultsWanted || undefined).map((posting) => mapPosting(posting, boardSlug));
}
