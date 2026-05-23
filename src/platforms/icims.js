import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

const XML_HEADERS = {
    Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
};

const toIsoDate = (value) => {
    if (!value) return undefined;
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
};

const extractJobId = (url) => {
    if (!url || typeof url !== 'string') return undefined;
    const m = url.match(/\/jobs\/(\d+)\//);
    return m?.[1];
};

const parseSitemapUrls = (xmlText) => {
    if (!xmlText || typeof xmlText !== 'string') return [];
    const $ = cheerioLoad(xmlText, { xmlMode: true });
    const entries = [];
    $('url').each((_, el) => {
        const loc = $(el).find('loc').first().text().trim();
        const lastmod = $(el).find('lastmod').first().text().trim();
        if (loc) {
            entries.push({
                loc,
                lastmod: lastmod || undefined,
            });
        }
    });
    return entries;
};

const extractDescriptionFromHtml = (html) => {
    if (!html || typeof html !== 'string') return undefined;
    const $ = cheerioLoad(html);
    const selectors = ['[itemprop="description"]', '.iCIMS_JobContent', '.job-content', 'main'];
    for (const selector of selectors) {
        const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
        if (text && text.length > 60) return text;
    }
    return undefined;
};

/**
 * Scrape iCIMS jobs from XML sitemap feeds (API/feed-based only).
 * This avoids HTML selectors and works across many iCIMS portals.
 */
export async function scrape({ rawUrl, slug }, { resultsWanted = 20, proxyUrl, allowHtmlDetailFallback = false } = {}) {
    const origins = [];
    if (rawUrl) {
        try {
            origins.push(new URL(rawUrl).origin);
        } catch {
            // Ignore malformed rawUrl and continue with generated host variants.
        }
    }
    if (slug) {
        origins.push(`https://careers-${slug}.icims.com`);
        origins.push(`https://careersen-${slug}.icims.com`);
        origins.push(`https://careers.${slug}.icims.com`);
    }
    const uniqueOrigins = [...new Set(origins)];

    log.info(`[iCIMS] Discovering jobs from sitemap feeds for ${uniqueOrigins.join(', ')}`);

    let sitemapEntries = [];
    let selectedOrigin = uniqueOrigins[0] || '';
    for (const origin of uniqueOrigins) {
        const candidateSitemaps = [
            `${origin}/sitemap.xml`,
            `${origin}/jobs/sitemap.xml`,
            `${origin}/sitemap_index.xml`,
        ];
        for (const sitemapUrl of candidateSitemaps) {
            try {
                const response = await gotScraping({
                    url: sitemapUrl,
                    proxyUrl,
                    headers: XML_HEADERS,
                    method: 'GET',
                    responseType: 'text',
                    throwHttpErrors: false,
                    timeout: { request: 30_000 },
                });
                if ((response.statusCode || 0) >= 400) {
                    log.warning(`[iCIMS] Sitemap endpoint returned HTTP ${response.statusCode}: ${sitemapUrl}`);
                    continue;
                }
                const xmlText = String(response.body || '');
                const parsed = parseSitemapUrls(xmlText);
                if (parsed.length) {
                    sitemapEntries = parsed;
                    selectedOrigin = origin;
                    log.info(`[iCIMS] Loaded ${parsed.length} sitemap URLs from ${sitemapUrl}`);
                    break;
                }
                log.warning(`[iCIMS] Sitemap returned no URL entries: ${sitemapUrl}`);
            } catch (err) {
                log.warning(`[iCIMS] Sitemap fetch failed (${sitemapUrl}): ${err.message}`);
            }
        }
        if (sitemapEntries.length) break;
    }

    if (!sitemapEntries.length) {
        log.warning(`[iCIMS] No sitemap URLs found for any origin variant`);
        return [];
    }

    const jobUrls = sitemapEntries
        .filter((entry) => /\/jobs\/\d+\/.+\/job/i.test(entry.loc))
        .slice(0, resultsWanted);

    const jobs = jobUrls.map((entry) => {
        const jobUrl = entry.loc;
        const pathParts = new URL(jobUrl).pathname.split('/').filter(Boolean);
        const slugFromPath = pathParts[2] || '';
        const titleFromPath = slugFromPath
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (m) => m.toUpperCase())
            .trim();

        return {
            job_id: extractJobId(jobUrl),
            title: titleFromPath || `Job ${extractJobId(jobUrl) || ''}`.trim(),
            company: slug,
            date_posted: toIsoDate(entry.lastmod),
            url: jobUrl,
            apply_url: jobUrl,
            source_feed_url: `${selectedOrigin}/sitemap.xml`,
            platform: 'icims',
            ats_family: 'icims',
        };
    });

    if (allowHtmlDetailFallback) {
        for (const job of jobs) {
            if (!job.url) continue;
            try {
                const response = await gotScraping({
                    url: job.url,
                    proxyUrl,
                    responseType: 'text',
                    throwHttpErrors: false,
                    timeout: { request: 30_000 },
                });
                if ((response.statusCode || 0) >= 400) continue;
                const description = extractDescriptionFromHtml(String(response.body || ''));
                if (description) job.description = description;
            } catch (err) {
                log.debug(`[iCIMS] HTML fallback failed for ${job.url}: ${err.message}`);
            }
        }
    }

    log.info(`[iCIMS] Prepared ${jobs.length} jobs from sitemap feed`);
    return jobs;
}
