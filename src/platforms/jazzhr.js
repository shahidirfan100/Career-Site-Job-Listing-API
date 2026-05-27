import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const toAbsolute = (href, base) => {
    if (!href) return null;
    try {
        return new URL(href, base).toString();
    } catch {
        return null;
    }
};

const parseLdJson = (html) => {
    const $ = cheerioLoad(html || '');
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const script of scripts) {
        const raw = $(script).text().trim();
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            const nodes = Array.isArray(parsed) ? parsed : [parsed];
            const posting = nodes.find((node) => node?.['@type'] === 'JobPosting') || null;
            if (posting) return posting;
        } catch {
            // Ignore malformed JSON-LD blocks.
        }
    }
    return null;
};

const extractFromApplyPage = async ({ slug, baseUrl, proxyUrl, resultsWanted }) => {
    const listingUrl = `${baseUrl}/apply`;
    const response = await gotScraping({
        url: listingUrl,
        proxyUrl,
        responseType: 'text',
        throwHttpErrors: false,
        timeout: { request: 30_000 },
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });

    if ((response.statusCode || 0) >= 400) {
        throw new Error(`Apply page returned HTTP ${response.statusCode}`);
    }

    const html = String(response.body || '');
    const $ = cheerioLoad(html);
    const links = new Map();

    $('a[href*="/apply/"]').each((_, el) => {
        const href = toAbsolute($(el).attr('href') || '', baseUrl);
        if (!href || !/\/apply\/[A-Za-z0-9]+/i.test(href)) return;
        const title = $(el).text().replace(/\s+/g, ' ').trim();
        if (!links.has(href)) {
            links.set(href, {
                title: title || null,
                url: href,
            });
        }
    });

    const jobs = [...links.values()].slice(0, resultsWanted || links.size);

    for (const job of jobs) {
        try {
            const detail = await gotScraping({
                url: job.url,
                proxyUrl,
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 30_000 },
            });
            if ((detail.statusCode || 0) >= 400) continue;

            const detailHtml = String(detail.body || '');
            const posting = parseLdJson(detailHtml);
            const $detail = cheerioLoad(detailHtml);

            const description = posting?.description
                || $detail('.job-description, .description, main').first().text().replace(/\s+/g, ' ').trim()
                || null;

            if (!job.title) {
                job.title = posting?.title
                    || $detail('h1, h2').first().text().replace(/\s+/g, ' ').trim()
                    || null;
            }

            job.location = posting?.jobLocation?.address?.addressLocality
                || posting?.jobLocation?.address?.addressRegion
                || posting?.jobLocation?.address?.addressCountry
                || null;
            job.city = posting?.jobLocation?.address?.addressLocality || null;
            job.state = posting?.jobLocation?.address?.addressRegion || null;
            job.country = posting?.jobLocation?.address?.addressCountry || null;
            job.date_posted = parseDate(posting?.datePosted || posting?.validThrough);
            job.job_type = posting?.employmentType || null;
            job.description = stripHtml(description);
        } catch (err) {
            log.debug(`[JazzHR] Detail extraction failed for ${job.url}: ${err.message}`);
        }
    }

    return jobs.map((j) => cleanObj({
        job_id: (j.url.match(/\/apply\/([A-Za-z0-9]+)/)?.[1]) || null,
        title: j.title || null,
        company: slug,
        location: j.location || null,
        city: j.city || null,
        state: j.state || null,
        country: j.country || null,
        department: null,
        job_type: j.job_type || null,
        date_posted: j.date_posted || null,
        url: j.url || null,
        apply_url: j.url || null,
        description: j.description || null,
        platform: 'jazzhr',
    }));
};

/**
 * Scrape jobs from JazzHR.
 * API: https://{slug}.jazz.co/api/recruiting/jobs
 */
export async function scrape({ slug }, { resultsWanted, proxyUrl } = {}) {
    const baseUrl = `https://${slug}.jazz.co`;
    const url = `${baseUrl}/api/recruiting/jobs`;
    log.info(`[JazzHR] Fetching jobs for company: ${slug}`);

    let data;
    try {
        data = await fetchJson(url, { proxyUrl });
    } catch (err) {
        log.warning(`[JazzHR] API endpoint failed for ${slug}: ${err.message}. Falling back to apply board parsing.`);
        try {
            return await extractFromApplyPage({ slug, baseUrl, proxyUrl, resultsWanted });
        } catch (fallbackErr) {
            log.error(`[JazzHR] Fallback parsing failed for ${slug}: ${fallbackErr.message}`);
            return [];
        }
    }

    const jobs = Array.isArray(data) ? data : (data?.jobs ?? []);
    log.info(`[JazzHR] Found ${jobs.length} jobs for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => cleanObj({
        job_id: j.board_code || j.id || null,
        title: j.title || null,
        company: slug,
        location: [j.city, j.state, j.country].filter(Boolean).join(', ') || null,
        city: j.city || null,
        state: j.state || null,
        country: j.country || null,
        department: j.department || null,
        job_type: j.type || null,
        date_posted: parseDate(j.original_open_date),
        url: j.board_code_url || `https://${slug}.jazz.co/apply/${j.board_code}`,
        apply_url: j.apply_url || null,
        description: stripHtml(j.description || j.job_description || j.content),
        platform: 'jazzhr',
    }));
}
