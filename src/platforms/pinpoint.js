import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const locationLabel = (location) => {
    if (typeof location === 'string') return location;
    if (!location || typeof location !== 'object') return null;
    return location.name
        || [location.city, location.province, location.country].filter(Boolean).join(', ')
        || null;
};

/**
 * Read the public Pinpoint board feed at https://{tenant}.pinpointhq.com/postings.json.
 */
export async function scrape({ slug, rawUrl, prefetchedData }, { resultsWanted, proxyUrl } = {}) {
    const base = rawUrl ? new URL(rawUrl).origin : `https://${slug}.pinpointhq.com`;

    let data = prefetchedData;
    if (data === undefined) {
        const url = `${base}/postings.json`;
        try {
            data = await fetchJson(url, { proxyUrl, origin: base, referer: `${base}/` });
        } catch (err) {
            log.warning(`[Pinpoint] Public postings feed failed for ${slug}: ${err.message}`);
            return [];
        }
    }

    const postings = Array.isArray(data) ? data : data?.data ?? data?.postings ?? data?.jobs;
    if (!Array.isArray(postings)) {
        log.warning(`[Pinpoint] Unexpected feed response for ${slug}.`);
        return [];
    }

    const limited = resultsWanted ? postings.slice(0, resultsWanted) : postings;
    return limited.map((posting) => {
        const location = locationLabel(posting.location);
        const workplace = posting.workplace_type_text || posting.workplace_type || null;
        return cleanObj({
            job_id: posting.id || posting.job_id || null,
            title: posting.title || posting.name || null,
            company: posting.company?.name || slug,
            location,
            city: posting.location?.city || null,
            state: posting.location?.province || null,
            country: posting.location?.country || null,
            department: posting.department?.name || posting.department || null,
            job_type: posting.employment_type_text || posting.employment_type || null,
            workplace_type: workplace,
            remote: /remote/i.test(workplace || location || '') ? true : undefined,
            date_posted: parseDate(posting.published_at || posting.created_at || posting.date_posted),
            updated_at: parseDate(posting.updated_at || posting.published_at || posting.created_at),
            url: posting.url || posting.careers_url || (posting.path ? new URL(posting.path, base).toString() : null),
            apply_url: posting.apply_url || posting.application_url || posting.url || null,
            description: stripHtml(posting.description || posting.description_text || posting.job_description),
            platform: 'pinpoint',
        });
    });
}
