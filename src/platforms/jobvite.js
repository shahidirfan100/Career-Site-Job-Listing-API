import { log } from 'apify';
import { load as cheerioLoad } from 'cheerio';

import { cleanObj, fetchHtml, fetchXml, parseDate } from '../utils/http.js';

const findCompanyEId = (html) => {
    const patterns = [
        /companyEId\s*:\s*['"]([^'"]+)['"]/i,
        /companyEId\s*=\s*['"]([^'"]+)['"]/i,
        /companyId\s*\(\s*\)\s*\{\s*return\s*['"]([^'"]+)['"]/i,
    ];
    for (const pattern of patterns) {
        const value = html.match(pattern)?.[1]?.trim();
        if (value) return value;
    }
    return null;
};

const readJobFields = (jobNode, $) => {
    const fields = new Map();
    $(jobNode).find('*').each((_, element) => {
        const name = element.name?.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (name && !fields.has(name)) fields.set(name, $(element).text().trim());
    });
    return (...names) => names.map((name) => fields.get(name)).find(Boolean) || null;
};

const cleanHtml = (value) => {
    if (!value) return null;
    const $ = cheerioLoad(value);
    const text = $.root().text().replace(/\s+/g, ' ').trim();
    return text || null;
};

const secureJobviteUrl = (value) => {
    if (typeof value !== 'string') return value;
    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' && (parsed.hostname === 'jobvite.com' || parsed.hostname.endsWith('.jobvite.com'))) {
            parsed.protocol = 'https:';
        }
        return parsed.toString();
    } catch {
        return value;
    }
};

/**
 * Jobvite's public XML feed is keyed by a companyEId embedded in its board page.
 * The page request is used only to discover that feed identifier; listings come from XML.
 */
export async function scrape({ slug, rawUrl, companyEId, feedUrl }, { resultsWanted, proxyUrl } = {}) {
    let resolvedEId = companyEId || null;
    let resolvedFeedUrl = feedUrl || null;
    const boardUrl = rawUrl || `https://jobs.jobvite.com/${encodeURIComponent(slug)}`;

    if (!resolvedFeedUrl && !resolvedEId) {
        try {
            const page = await fetchHtml(boardUrl, { proxyUrl, retries: 2 });
            if ((page.statusCode || 0) >= 400) {
                log.warning(`[Jobvite] Board page returned HTTP ${page.statusCode} for ${slug}.`);
                return [];
            }
            resolvedEId = findCompanyEId(String(page.body || ''));
        } catch (err) {
            log.warning(`[Jobvite] Could not read board metadata for ${slug}: ${err.message}`);
            return [];
        }
    }

    if (!resolvedFeedUrl && resolvedEId) {
        resolvedFeedUrl = `https://app.jobvite.com/CompanyJobs/Xml.aspx?c=${encodeURIComponent(resolvedEId)}`;
    }
    if (!resolvedFeedUrl) {
        log.warning(`[Jobvite] No public feed identifier was found for ${slug}.`);
        return [];
    }

    let response;
    try {
        response = await fetchXml(resolvedFeedUrl, {
            proxyUrl,
            origin: 'https://jobs.jobvite.com',
            referer: boardUrl,
            retries: 3,
        });
    } catch (err) {
        log.warning(`[Jobvite] XML feed request failed for ${slug}: ${err.message}`);
        return [];
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        log.warning(`[Jobvite] XML feed returned HTTP ${response.statusCode} for ${slug}.`);
        return [];
    }

    const $ = cheerioLoad(response.body, { xmlMode: true });
    const jobNodes = $('Job').length ? $('Job') : $('job');
    if (!jobNodes.length && /<(?:jobs|joblist)\b/i.test(response.body)) {
        log.info(`[Jobvite] No open postings in the public feed for ${slug}.`);
        return [];
    }

    const nodes = resultsWanted ? jobNodes.slice(0, resultsWanted) : jobNodes;
    return nodes.map((_, jobNode) => {
        const value = readJobFields(jobNode, $);
        const jobUrl = value('joburl', 'jobdetailurl', 'detailurl', 'careersurl', 'url');
        const applyUrl = value('applyurl', 'applicationurl');
        return cleanObj({
            job_id: value('jobid', 'requisitionid', 'reqid', 'requisitionnumber', 'id'),
            title: value('jobtitle', 'title', 'positiontitle', 'requisitiontitle'),
            company: value('companyname', 'company') || slug,
            location: value('location', 'locationname', 'locationtext'),
            city: value('city'),
            state: value('state', 'province', 'region'),
            country: value('country'),
            department: value('department', 'departmentname'),
            job_type: value('employmenttype', 'jobtype', 'type'),
            date_posted: parseDate(value('dateposted', 'postingdate', 'createddate', 'createdat', 'date')),
            updated_at: parseDate(value('updateddate', 'updatedat')),
            url: secureJobviteUrl(jobUrl),
            apply_url: secureJobviteUrl(applyUrl || jobUrl),
            description: cleanHtml(value('jobdescription', 'description', 'details')),
            platform: 'jobvite',
        });
    }).get();
}
