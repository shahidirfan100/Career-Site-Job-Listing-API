import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';

import { cleanObj, fetchXml } from '../utils/http.js';

const stripHtml = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const secureJazzUrl = (value) => {
    if (typeof value !== 'string') return value;
    try {
        const url = new URL(value);
        if (url.protocol === 'http:' && /(?:^|\.)jazz(?:hr)?\.com$/.test(url.hostname)) url.protocol = 'https:';
        return url.toString();
    } catch {
        return value;
    }
};

/** JazzHR's public employer-scoped listings feed is XML and needs no API key. */
export async function scrape({ slug, feedUrl }, { resultsWanted, proxyUrl } = {}) {
    const url = feedUrl || `https://app.jazz.co/feeds/export/jobs/${encodeURIComponent(slug)}`;
    let response;
    try {
        response = await fetchXml(url, {
            proxyUrl,
            origin: 'https://app.jazz.co',
            referer: 'https://app.jazz.co/',
            retries: 3,
        });
    } catch (err) {
        log.warning(`[JazzHR] Public XML feed failed for ${slug}: ${err.message}`);
        return [];
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        log.warning(`[JazzHR] XML feed returned HTTP ${response.statusCode} for ${slug}.`);
        return [];
    }

    const $ = cheerioLoad(response.body || '', { xmlMode: true });
    const company = $('jobs > company').first().text().trim() || slug;
    const nodes = $('jobs > job');
    if (!nodes.length) {
        log.info(`[JazzHR] Public feed contains no open postings for ${slug}.`);
        return [];
    }

    const limited = resultsWanted ? nodes.slice(0, resultsWanted) : nodes;
    return limited.map((_, job) => {
        const value = (name) => $(job).children(name).first().text().trim() || null;
        const jobUrl = secureJazzUrl(value('url'));
        const location = [value('city'), value('state'), value('country')].filter(Boolean).join(', ');
        return cleanObj({
            job_id: value('id'),
            title: value('title'),
            company,
            location: location || null,
            city: value('city'),
            state: value('state'),
            country: value('country'),
            department: value('department'),
            job_type: value('type'),
            url: jobUrl,
            apply_url: jobUrl,
            description: stripHtml(value('description')),
            platform: 'jazzhr',
        });
    }).get();
}
