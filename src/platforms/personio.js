import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

import { cleanObj, fetchJson, parseDate } from '../utils/http.js';

const stripHtml = (value) => {
    if (!value || typeof value !== 'string') return null;
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
};

const collectPersonioDescription = (attr) => {
    if (!attr || typeof attr !== 'object') return null;
    const descObj = attr.jobDescriptions || attr.descriptions || null;
    if (!descObj || typeof descObj !== 'object') return null;
    const blocks = [];
    for (const value of Object.values(descObj)) {
        if (!value) continue;
        if (typeof value === 'string') {
            const cleaned = stripHtml(value);
            if (cleaned) blocks.push(cleaned);
            continue;
        }
        if (typeof value === 'object') {
            const cleaned = stripHtml(value.value || value.text || value.description || '');
            if (cleaned) blocks.push(cleaned);
        }
    }
    return blocks.length ? blocks.join('\n\n') : null;
};

/**
 * Parse jobs from Personio XML feed.
 */
const parseXmlJobs = (xmlText, host, slug) => {
    const $ = cheerioLoad(xmlText || '', { xmlMode: true });
    const positions = [];

    $('position').each((_, el) => {
        const id = $(el).find('id').first().text().trim();
        const title = $(el).find('name').first().text().trim();
        const office = $(el).find('office').first().text().trim();
        const department = $(el).find('recruitingCategory').first().text().trim();
        const employmentType = $(el).find('employmentType').first().text().trim();
        const schedule = $(el).find('schedule').first().text().trim();
        const createdAt = $(el).find('createdAt').first().text().trim();

        // Collect descriptions
        const descParts = [];
        $(el).find('jobDescription').each((_, descEl) => {
            const partName = $(descEl).find('name').first().text().trim();
            const partVal = $(descEl).find('value').first().text().trim();
            const cleanVal = stripHtml(partVal);
            if (cleanVal) {
                if (partName) {
                    descParts.push(`${partName}:\n${cleanVal}`);
                } else {
                    descParts.push(cleanVal);
                }
            }
        });
        const description = descParts.join('\n\n') || null;

        positions.push(cleanObj({
            job_id: id || null,
            title: title || null,
            company: slug,
            location: office || null,
            city: office || null,
            department: department || null,
            job_type: [employmentType, schedule].filter(Boolean).join(' / ') || null,
            date_posted: parseDate(createdAt),
            url: `https://${host}/job/${id}`,
            apply_url: null,
            description,
            platform: 'personio',
        }));
    });

    return positions;
};

/**
 * Scrape jobs from Personio.
 * Primary: XML Feed (https://{host}/xml)
 * Secondary: JSON API (https://{host}/api/v1/jobs)
 */
export async function scrape({ slug, rawUrl }, { resultsWanted, proxyUrl } = {}) {
    const host = rawUrl ? new URL(rawUrl).hostname : `${slug}.jobs.personio.de`;
    log.info(`[Personio] Fetching jobs for company: ${slug}`);

    // Try XML Feed first (highly reliable, standard for all boards)
    const xmlUrl = `https://${host}/xml?language=en`;
    try {
        log.info(`[Personio] Trying XML Feed: ${xmlUrl}`);
        const response = await gotScraping({
            url: xmlUrl,
            proxyUrl,
            method: 'GET',
            responseType: 'text',
            timeout: { request: 20_000 },
        });

        if (response.statusCode === 200 && response.body) {
            const xmlText = String(response.body);
            if (xmlText.includes('<workzag-jobs>') || xmlText.includes('<position>')) {
                const xmlJobs = parseXmlJobs(xmlText, host, slug);
                log.info(`[Personio] Found ${xmlJobs.length} jobs via XML Feed`);
                return resultsWanted ? xmlJobs.slice(0, resultsWanted) : xmlJobs;
            }
        }
    } catch (err) {
        log.warning(`[Personio] XML Feed failed for ${slug}: ${err.message}. Trying JSON API fallback.`);
    }

    // Fallback to JSON API
    const jsonUrl = `https://${host}/api/v1/jobs?language=en`;
    let data;
    try {
        log.info(`[Personio] Trying JSON API: ${jsonUrl}`);
        data = await fetchJson(jsonUrl, { proxyUrl });
    } catch {
        // Fallback domain for JSON API
        const fallbackJsonUrl = `https://${slug}.jobs.personio.de/api/v1/jobs?language=en`;
        try {
            log.info(`[Personio] Trying Fallback JSON API: ${fallbackJsonUrl}`);
            data = await fetchJson(fallbackJsonUrl, { proxyUrl });
        } catch (err2) {
            log.error(`[Personio] Both XML and JSON API failed for ${slug}: ${err2.message}`);
            return [];
        }
    }

    const jobs = Array.isArray(data) ? data : (data?.data ?? data?.jobs ?? []);
    if (!Array.isArray(jobs)) {
        log.warning(`[Personio] Unexpected JSON response shape. Keys: ${Object.keys(data || {}).join(', ')}`);
        return [];
    }

    log.info(`[Personio] Found ${jobs.length} jobs via JSON API for ${slug}`);
    const limited = resultsWanted ? jobs.slice(0, resultsWanted) : jobs;

    return limited.map((j) => {
        const attr = j.attributes ?? j;
        return cleanObj({
            job_id: j.id || attr.id || null,
            title: attr.name || attr.title || null,
            company: slug,
            location: attr.office || attr.location || null,
            city: attr.office || null,
            department: attr.department || null,
            job_type: attr.employment_type || null,
            date_posted: parseDate(attr.created_at || j.created_at),
            url: `https://${host}/job/${j.id}`,
            apply_url: null,
            description: collectPersonioDescription(attr),
            platform: 'personio',
        });
    });
}
