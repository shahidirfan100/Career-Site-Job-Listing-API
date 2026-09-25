/**
 * Detect ATS platform from a career board URL.
 * Returns { platform, slug, ...extra } or null if unknown.
 */
export function detectPlatform(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch { return null; }

    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const firstPart = parts[0] || null;
    const localePattern = /^[a-z]{2}(?:-[a-z]{2})?$/i;

    // ── Lever ───────────────────────────────────────────────────────────────
    if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
        const slug = parts[0];
        if (slug) return { platform: 'lever', slug, isEU: host === 'jobs.eu.lever.co' };
    }
    if (host === 'api.lever.co' || host === 'api.eu.lever.co') {
        const slug = parts[0] === 'v0' && parts[1] === 'postings' ? parts[2] : null;
        if (slug) return { platform: 'lever', slug, isEU: host === 'api.eu.lever.co', rawUrl };
    }

    // ── Greenhouse ──────────────────────────────────────────────────────────
    if (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') {
        let slug = firstPart;
        if (slug === 'embed' || slug === 'job_board' || slug === 'job_app') {
            slug = u.searchParams.get('for')
                || u.searchParams.get('company');
        }
        if (slug) return { platform: 'greenhouse', slug };
    }
    if (host === 'boards-api.greenhouse.io') {
        const slug = parts[0] === 'v1' && parts[1] === 'boards' ? parts[2] : null;
        if (slug) return { platform: 'greenhouse', slug, rawUrl };
    }

    // ── Manatal ────────────────────────────────────────────────────────────
    if (host === 'api.manatal.com' || host === 'core.api.manatal.com') {
        const careerPageIndex = parts.findIndex((part) => part.toLowerCase() === 'career-page');
        const slug = careerPageIndex >= 0 ? parts[careerPageIndex + 1] : null;
        if (slug) return { platform: 'manatal', slug, clientSlug: slug, rawUrl };
    }
    if (host === 'careers.manatal.com') {
        return { platform: 'manatal', slug: 'manatal', clientSlug: 'manatal', rawUrl };
    }
    if (host === 'careers-page.com' || host === 'www.careers-page.com' || host.endsWith('.careers-page.com')) {
        const tenantFromHost = host.endsWith('.careers-page.com') && host !== 'www.careers-page.com'
            ? host.replace(/\.careers-page\.com$/, '')
            : null;
        const slug = parts[0] || tenantFromHost;
        if (slug && slug.toLowerCase() !== 'jobs') {
            return { platform: 'manatal', slug, clientSlug: slug, rawUrl };
        }
    }

    // ── Ashby ────────────────────────────────────────────────────────────────
    if (host === 'jobs.ashbyhq.com') {
        const slug = parts[0];
        if (slug) return { platform: 'ashby', slug };
    }
    if (host === 'api.ashbyhq.com' && parts[0] === 'posting-api' && parts[1] === 'job-board') {
        const slug = parts[2];
        if (slug) return { platform: 'ashby', slug, rawUrl };
    }

    // ── SmartRecruiters ─────────────────────────────────────────────────────
    if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
        const slug = parts[0];
        if (slug) return { platform: 'smartrecruiters', slug };
    }

    // ── Jobvite ─────────────────────────────────────────────────────────────
    if (host === 'jobs.jobvite.com') {
        const slug = parts[0];
        if (slug) return { platform: 'jobvite', slug, rawUrl };
    }
    if (host === 'app.jobvite.com' && parts[0]?.toLowerCase() === 'companyjobs') {
        const companyEId = u.searchParams.get('c');
        if (parts[1]?.toLowerCase() === 'xml.aspx' && companyEId) {
            return { platform: 'jobvite', slug: companyEId, companyEId, feedUrl: rawUrl, rawUrl };
        }
    }

    // ── Rippling ────────────────────────────────────────────────────────────
    if (host === 'ats.rippling.com') {
        const loweredParts = parts.map((part) => part.toLowerCase());
        const jobsIndex = loweredParts.indexOf('jobs');
        const slugIndex = jobsIndex - 1;
        if (jobsIndex > 0 && parts[slugIndex]) {
            return { platform: 'rippling', slug: parts[slugIndex], rawUrl };
        }
    }
    if (host === 'api.rippling.com' && parts[0] === 'platform' && parts[1] === 'api' && parts[2] === 'ats' && parts[3] === 'v1' && parts[4] === 'board') {
        const slug = parts[5];
        if (slug) return { platform: 'rippling', slug, rawUrl };
    }

    // ── Pinpoint ────────────────────────────────────────────────────────────
    if (host.endsWith('.pinpointhq.com')) {
        const slug = host.replace(/\.pinpointhq\.com$/, '');
        if (slug && slug !== 'www') return { platform: 'pinpoint', slug, rawUrl };
    }

    // ── Workable ─────────────────────────────────────────────────────────────
    if (host === 'apply.workable.com') {
        const slug = parts[0];
        if (slug) return { platform: 'workable', slug };
    }

    // ── Recruitee ────────────────────────────────────────────────────────────
    if (host.endsWith('.recruitee.com')) {
        const slug = host.replace('.recruitee.com', '');
        if (slug) return { platform: 'recruitee', slug };
    }

    // ── BreezyHR ─────────────────────────────────────────────────────────────
    if (host.endsWith('.breezy.hr')) {
        const slug = host.replace('.breezy.hr', '');
        if (slug) return { platform: 'breezyhr', slug };
    }

    // ── BambooHR ─────────────────────────────────────────────────────────────
    if (host.endsWith('.bamboohr.com')) {
        const slug = host.replace('.bamboohr.com', '');
        if (slug) return { platform: 'bamboohr', slug };
    }

    // ── Workday ──────────────────────────────────────────────────────────────
    const wdMatch = host.match(/^(.+)\.(wd\d+)\.myworkdayjobs\.com$/);
    if (wdMatch) {
        let board = firstPart || 'Careers';
        if (localePattern.test(board) && parts[1]) board = parts[1];
        return {
            platform: 'workday',
            slug: wdMatch[1],
            instance: wdMatch[2],
            board,
            rawUrl,
        };
    }
    if (host.endsWith('.myworkdayjobs.com')) {
        const left = host.replace(/\.myworkdayjobs\.com$/, '');
        const labels = left.split('.').filter(Boolean);
        const maybeTenant = labels.find((label) => !/^wd\d+$/i.test(label)) || labels[0];
        let board = firstPart || 'Careers';
        if (localePattern.test(board) && parts[1]) board = parts[1];
        if (maybeTenant) {
            return {
                platform: 'workday',
                slug: maybeTenant,
                board,
                rawUrl,
            };
        }
    }
    if (host.endsWith('.myworkdaysite.com')) {
        const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === 'recruiting');
        if (recruitingIndex >= 0) {
            const slug = parts[recruitingIndex + 1];
            const board = parts[recruitingIndex + 2] || 'external';
            if (slug) {
                return {
                    platform: 'workday',
                    slug,
                    board,
                    rawUrl,
                };
            }
        }
        const left = host.replace(/\.myworkdaysite\.com$/, '');
        const fallbackSlug = left.split('.').find((label) => !/^wd\d+$/i.test(label)) || left.split('.')[0];
        if (fallbackSlug) {
            return {
                platform: 'workday',
                slug: fallbackSlug,
                board: 'external',
                rawUrl,
            };
        }
    }
    if (host.endsWith('.workday.com') && parts.some((part) => part.toLowerCase() === 'recruiting')) {
        const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === 'recruiting');
        const slug = parts[recruitingIndex + 1];
        const board = parts[recruitingIndex + 2] || 'external';
        if (slug) {
            return {
                platform: 'workday',
                slug,
                board,
                rawUrl,
            };
        }
    }

    // ── Workday CXS direct API URLs ─────────────────────────────────────────
    if (parts[0]?.toLowerCase() === 'wday' && parts[1]?.toLowerCase() === 'cxs') {
        const slug = parts[2];
        const board = parts[3] || 'Careers';
        if (slug) {
            return {
                platform: 'workday',
                slug,
                board,
                rawUrl,
            };
        }
    }

    // ── Workday generic recruiting paths ────────────────────────────────────
    if (parts.length >= 3 && parts.some((part) => part.toLowerCase() === 'recruiting')) {
        const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === 'recruiting');
        const slug = parts[recruitingIndex + 1];
        const board = parts[recruitingIndex + 2] || 'external';
        if (slug) {
            return {
                platform: 'workday',
                slug,
                board,
                rawUrl,
            };
        }
    }

    // ── Workday legacy fallback based on known data-center label ────────────
    const wdLooseMatch = host.match(/^(?:([^.]*)\.)?(wd\d+)\./);
    if (wdLooseMatch) {
        const slug = wdLooseMatch[1] || 'workday';
        let board = firstPart || 'Careers';
        if (localePattern.test(board) && parts[1]) board = parts[1];
        return {
            platform: 'workday',
            slug,
            instance: wdLooseMatch[2],
            board,
            rawUrl,
        };
    }

    // ── TeamTailor ───────────────────────────────────────────────────────────
    if (host.endsWith('.teamtailor.com')) {
        const slug = host.replace('.teamtailor.com', '');
        if (slug) return { platform: 'teamtailor', slug, rawUrl };
    }
    if (host.endsWith('.teamtailor.net')) {
        const slug = host.replace('.teamtailor.net', '');
        if (slug) return { platform: 'teamtailor', slug, rawUrl };
    }
    // ── Personio ─────────────────────────────────────────────────────────────
    if (host.endsWith('.personio.de') || host.endsWith('.personio.com')) {
        const slug = host.split('.')[0];
        if (slug) return { platform: 'personio', slug, rawUrl };
    }

    // ── JazzHR ───────────────────────────────────────────────────────────────
    if (host === 'app.jazz.co' && parts[0]?.toLowerCase() === 'feeds' && parts[1]?.toLowerCase() === 'export' && parts[2]?.toLowerCase() === 'jobs') {
        const slug = parts[3];
        if (slug) return { platform: 'jazzhr', slug, feedUrl: rawUrl, rawUrl };
    }
    if (host.endsWith('.jazz.co')) {
        const slug = host.replace('.jazz.co', '');
        if (slug) return { platform: 'jazzhr', slug };
    }

    // ── iCIMS ────────────────────────────────────────────────────────────────
    // Auto-heal multiple public iCIMS host styles:
    // careers-foo.icims.com, careers.foo.icims.com, careersen-foo.icims.com, etc.
    const icimsMatch = host.match(/^careers-(.+)\.icims\.com$/);
    if (icimsMatch) {
        return { platform: 'icims', slug: icimsMatch[1], rawUrl };
    }
    const icimsDotMatch = host.match(/^careers\.(.+)\.icims\.com$/);
    if (icimsDotMatch) {
        return { platform: 'icims', slug: icimsDotMatch[1], rawUrl };
    }
    if (host.endsWith('.icims.com')) {
        const left = host.replace(/\.icims\.com$/, '');
        let slug = left;
        // Remove careers/careersen/careersfr style prefixes with optional separator.
        slug = slug.replace(/^careers[a-z]*[-.]/, '');
        if (!slug) slug = left;
        return { platform: 'icims', slug, rawUrl };
    }

    // ── Taleo ────────────────────────────────────────────────────────────────
    if ((host.endsWith('.taleo.net') || host.endsWith('.brassring.com')) && parts[0] === 'careersection') {
        const section = parts[1] || null;
        const tld = host.endsWith('.taleo.net') ? '.taleo.net' : '.brassring.com';
        return {
            platform: 'taleo',
            slug: host.replace(tld, ''),
            section,
            rawUrl,
        };
    }

    return null;
}
