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

    // ── Greenhouse ──────────────────────────────────────────────────────────
    if (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') {
        let slug = firstPart;
        if (slug === 'embed' || slug === 'job_board' || slug === 'job_app') {
            slug = u.searchParams.get('for')
                || u.searchParams.get('company');
        }
        if (slug) return { platform: 'greenhouse', slug };
    }

    // ── Ashby ────────────────────────────────────────────────────────────────
    if (host === 'jobs.ashbyhq.com') {
        const slug = parts[0];
        if (slug) return { platform: 'ashby', slug };
    }

    // ── SmartRecruiters ─────────────────────────────────────────────────────
    if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
        const slug = parts[0];
        if (slug) return { platform: 'smartrecruiters', slug };
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
    if (parts[0] === 'wday' && parts[1] === 'cxs') {
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
    if (host.startsWith('careers.') && parts.length === 0) {
        const slug = host.split('.')[1];
        if (slug) return { platform: 'teamtailor', slug, rawUrl };
    }

    // ── Personio ─────────────────────────────────────────────────────────────
    if (host.endsWith('.personio.de') || host.endsWith('.personio.com')) {
        const slug = host.split('.')[0];
        if (slug) return { platform: 'personio', slug, rawUrl };
    }

    // ── JazzHR ───────────────────────────────────────────────────────────────
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
    if (host.endsWith('.taleo.net') && parts[0] === 'careersection') {
        const section = parts[1] || null;
        return {
            platform: 'taleo',
            slug: host.replace('.taleo.net', ''),
            section,
            rawUrl,
        };
    }

    return null;
}
