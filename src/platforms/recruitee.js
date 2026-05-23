import { log } from 'apify';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

/**
 * Scrape jobs from Recruitee API.
 * API: https://{slug}.recruitee.com/api/offers
 * Response: { offers: [...] }
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const url = `https://${slug}.recruitee.com/api/offers`;
    log.info(`[Recruitee] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, { proxyUrl });
    } catch (err) {
        log.error(`[Recruitee] API failed for ${slug}: ${err.message}`);
        return [];
    }

    const offers = data?.offers ?? [];
    if (!Array.isArray(offers)) {
        log.warning(`[Recruitee] Unexpected response. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[Recruitee] Found ${offers.length} offers for ${slug}`);
    const limited = resultsWanted ? offers.slice(0, resultsWanted) : offers;

    return limited.map((o) => cleanObj({
        job_id: o.id || o.slug || null,
        title: o.title || null,
        company: o.company?.name || slug,
        location: [o.city, o.country_code].filter(Boolean).join(', ') || null,
        city: o.city || null,
        country: o.country_code || null,
        department: o.department || null,
        job_type: o.employment_type_code || null,
        date_posted: parseDate(o.created_at || o.published_at),
        updated_at: parseDate(o.updated_at || o.published_at || o.created_at),
        url: o.careers_url || `https://${slug}.recruitee.com/o/${o.slug}`,
        apply_url: o.careers_apply_url || null,
        description: stripHtml(o.description || o.description_text || o.content || o.requirements),
        remote: o.remote === true ? true : undefined,
        tags: o.tags?.length ? o.tags : undefined,
        platform: 'recruitee',
    }));
}
