# API Discovery Notes

## Scope
- Goal: keep extraction API/feed-first for all supported ATS platforms.
- Job listings and detail fields are collected from public JSON/XML/RSS endpoints or feeds. HTML is used only as a discovery bootstrap (and to find Jobvite's public feed identifier), never as the job-list extraction source.
- Direct API/feed adapters are implemented for 18 ATS platforms: Ashby, BambooHR, BreezyHR, Greenhouse, iCIMS, JazzHR, Jobvite, Lever, Manatal, Pinpoint, Personio, Recruitee, Rippling, SmartRecruiters, Taleo, TeamTailor, Workable, and Workday.
- Input supports multi-board runs using `startUrls`.

## Input Contract
- `startUrls`: array of one or more career board URLs.
- `results_wanted`: max total jobs returned after normalization/dedupe.
- `max_pages`: requested page limit for paginated APIs; the Actor imposes no fixed upper ceiling.
- No keyword, location, or posting-date filters are exposed. The Actor collects listings from the supplied URL(s).

## URL Variant Normalization (Auto-Heal)
The detector accepts canonical and common variant URLs, then maps to one platform adapter:

- Greenhouse:
  - `https://job-boards.greenhouse.io/{slug}`
  - `https://boards.greenhouse.io/{slug}`
  - `https://boards.greenhouse.io/embed/job_board?for={slug}`
- SmartRecruiters:
  - `https://careers.smartrecruiters.com/{slug}`
  - `https://jobs.smartrecruiters.com/{slug}`
- Workday:
  - `https://{tenant}.wdN.myworkdayjobs.com/{board}`
  - `https://{host}.myworkdayjobs.com/{locale}/{board}`
  - `https://wdN.myworkdaysite.com/recruiting/{tenant}/{board}`
  - direct API path forms containing `/wday/cxs/`

This prevents false "unsupported platform" errors when a valid ATS board uses a different but equivalent URL form.

## API Request Patterns (Rich-Data First)

### Lever
- Detect: `jobs.lever.co/{slug}`, `jobs.eu.lever.co/{slug}`
- Request: `GET https://api.lever.co/v0/postings/{slug}?mode=json` (EU host uses `api.eu.lever.co`)
- Pattern: single list response, no pagination
- Rich fields: `descriptionPlain`, `categories`, `workplaceType`, `applyUrl`, `hostedUrl`

### Greenhouse
- Detect: `job-boards.greenhouse.io/{slug}`, `boards.greenhouse.io/{slug}`, embed board URL with `?for={slug}`
- Request: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- Pattern: single list response
- Rich fields: `content`, `departments`, `offices`, `absolute_url`, `updated_at`

### Ashby
- Detect: `jobs.ashbyhq.com/{slug}`
- Request: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`
- Pattern: single list response
- Rich fields: `descriptionHtml`, `teamName`, `workplaceType`, `publishedDate`, `jobUrl`

### SmartRecruiters
- Detect: `careers.smartrecruiters.com/{slug}`, `jobs.smartrecruiters.com/{slug}`
- Requests:
  - `GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit={limit}&offset={offset}`
  - detail enrichment: `GET https://api.smartrecruiters.com/v1/companies/{slug}/postings/{id}`
- Pattern: offset pagination + per-posting detail
- Rich fields: `jobAd.sections.*.text`, `typeOfEmployment`, `department`, `applyUrl`

### Workable
- Detect: `apply.workable.com/{slug}`
- Requests:
  - primary rich list: `GET https://www.workable.com/api/accounts/{slug}?details=true`
  - fallback paginated list: `POST https://apply.workable.com/api/v3/accounts/{slug}/jobs`
- Pattern: primary full list, fallback cursor paging
- Rich fields: `description`, `employment_type`, `telecommuting`, `application_url`

### Recruitee
- Detect: `{slug}.recruitee.com`
- Request: `GET https://{slug}.recruitee.com/api/offers`
- Pattern: single list response
- Rich fields: `description`, `requirements`, `careers_url`, `department`, `tags`

### BambooHR
- Detect: `{slug}.bamboohr.com/careers`
- Requests:
  - summary list: `GET https://{slug}.bamboohr.com/careers/list`
  - requested-job detail: `GET https://{slug}.bamboohr.com/careers/{id}/detail`
- Pattern: one public summary response followed by detail requests for the selected results, with concurrency limited to four; summary records are retained if a detail request fails.
- Rich fields: detail response `jobOpening.description`, share URL, department/employment labels, and expanded location data

### Workday
- Detect:
  - `{tenant}.wdN.myworkdayjobs.com/...`
  - `*.myworkdayjobs.com/...`
  - `wdN.myworkdaysite.com/recruiting/{tenant}/{board}`
  - URLs containing `/wday/cxs/`
- Requests:
  - list: `POST https://{origin}/wday/cxs/{tenant}/{board}/jobs` with payload `{ appliedFacets, limit, offset, searchText, userSelectedLanguage }`
  - detail: `GET .../jobPosting/{jobPostingId}` or resolved `externalPath`
- Pattern:
  - retry candidate list endpoints derived from URL
  - offset pagination with dynamic page size
  - concurrent detail fan-out for rich fields
- Rich fields: `jobDescription`, `hiringOrganization`, `jobFamily`, `compensation`, normalized location parts

### TeamTailor
- Detect: `{slug}.teamtailor.com`, `{slug}.teamtailor.net`; branded employer domains only when fetched markup contains Teamtailor embed/API evidence
- Requests:
  - `GET {origin}/jobs.json`
  - fallback `GET {origin}/api/jobs.json`
  - fallback `GET {origin}/en/jobs.json`
- Pattern: endpoint probing in order
- Rich fields: `attributes.body`, `career-page-url`, `apply-url`, remote/employment metadata

### Personio
- Detect: `{slug}.jobs.personio.de|com`
- Requests:
  - primary feed: `GET https://{host}/xml?language=en`
  - fallback API: `GET https://{host}/api/v1/jobs?language=en`
- Pattern: XML-first, JSON fallback
- Rich fields: `jobDescription` blocks (XML) or `jobDescriptions` objects (JSON)

### JazzHR
- Detect: `{slug}.jazz.co` or a direct `app.jazz.co/feeds/export/jobs/{slug}` URL.
- Request: `GET https://app.jazz.co/feeds/export/jobs/{slug}`.
- Pattern: one public employer-scoped XML feed; no API key. The feed embeds listing descriptions and detail/application URLs.
- Rich fields: job ID, title, company, department, location parts, type, description, and application URL. Posting dates are not present in the feed.

### iCIMS
- Detect: `careers-*.icims.com`, `careers.*.icims.com`, related host variants
- Requests:
  - `GET {origin}/sitemap.xml`
  - fallback `GET {origin}/jobs/sitemap.xml`
  - fallback `GET {origin}/sitemap_index.xml`
- Pattern: XML feed discovery across origin candidates
- Rich fields: feed gives stable job URLs and update dates; descriptions may not be included.

### Taleo
- Detect: `*.taleo.net/careersection/{section}`
- Bootstrap: `GET https://{host}/careersection/{section}/jobsearch.ftl?lang={locale}` to read the public portal ID and the career section's result-table headings.
- Primary request: `POST https://{host}/careersection/rest/jobboard/searchjobs?lang={locale}&portal={portalId}` with JSON pagination (`pageNo`) and sort settings.
- Pattern: paginated JSON endpoint used by the career section itself; stop at `results_wanted`, `max_pages`, or the source's `pagingData.totalCount`.
- Mapping: Taleo returns positional `column` arrays, so title, location, department, employment type, and posted date are mapped only when public table headings align with the row values. The explicit `linkedColumn` and `locationsColumns` metadata provide title/location fallbacks.
- Fallback: optional Career Section RSS endpoints are tried if the JSON endpoint is unavailable. Oracle documents RSS as off by default and limited to 10 jobs per feed; see [RSS Feature](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22b/otcug/c-rssfeature.html).

### Jobvite
- Detect: `jobs.jobvite.com/{slug}` or `app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}`.
- Request sequence: fetch the public board page for its opaque `companyEId`, then request `https://app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}`.
- Pattern: one XML listing feed; no API key. Empty feeds are valid. The feed can be large and may return `429`; shared HTTP handling applies bounded retries and `Retry-After`.
- Rich fields: requisition ID, title, location, job type, posted date, detail/apply URL, and description.

### Pinpoint
- Detect: `{tenant}.pinpointhq.com`; custom domains can be detected from page links or distinctive embedded payload fields.
- Request: `GET https://{tenant}.pinpointhq.com/postings.json`.
- Pattern: one public JSON feed, no API key.
- Rich fields: title, location parts, department, employment/workplace type, dates, URL, and description.

### Rippling
- Detect: `ats.rippling.com/{tenant}/jobs` or its public board API URL.
- Request: `GET https://api.rippling.com/platform/api/ats/v1/board/{tenant}/jobs`.
- Pattern: one company-scoped public JSON response, no API key.
- Rich fields: UUID, title, department, work location, job/application URL, and available description/date fields.

### Manatal
- Detect: `www.careers-page.com/{clientSlug}`, `careers.manatal.com`, or an embedded `/open/v3/career-page/{clientSlug}/jobs` API path.
- Request: `GET https://api.manatal.com/open/v3/career-page/{clientSlug}/jobs/?page={page}&page_size={pageSize}`.
- Detail reference: `GET https://api.manatal.com/open/v3/career-page/{clientSlug}/jobs/{id}/`.
- Pattern: documented public JSON listing API with page-number pagination; no API key for career-page listings.
- Rich fields: position, organization/department, description, city/state/country, contract type, remote indicator, job hash, and public job URL.

## Detection from fetched page data

Detection is not limited to the input hostname. For an unrecognized employer URL, the discovery pass checks:

1. ATS hostnames in anchor, script, iframe, form, data attributes, and serialized page text.
2. Known endpoint path shapes embedded without a vendor hostname, including Workday CXS, Lever postings, Greenhouse board API, Ashby job-board API, SmartRecruiters postings, Jobvite company IDs, and Manatal career-page API paths.
3. Vendor embed markers for custom-domain career sites where an existing adapter can use the employer origin.
4. Parsed JSON and JSON script payloads for distinctive per-job schemas. Generic `{ title, location, description }` records alone do not identify an ATS safely.

For supported payload fingerprints, the matching adapter maps embedded records directly instead of making a redundant list request. If a page exposes no supported URL, marker, endpoint path, or unique data shape, discovery returns no match rather than guessing.

## Search scope

This Actor collects listings from the supplied URL(s) and does not expose keyword, location, or posting-date filters. It also has no global company/board index for searching all ATS platforms from a query. The referenced [Career Site Job Listing API](https://apify.com/fantastic-jobs/career-site-job-listing-api) documents an indexed-database model with ATS and company filters. A large-scale catalog pattern is also visible in [JobSeek](https://github.com/colophon-group/jobseek), which separates company/board records, source monitors, platform scrapers, and search storage; [ats-scrapers](https://github.com/kalil0321/ats-scrapers) uses an adapter/registry model and shared output; and [CareerScout](https://github.com/Ramcharan747/careerscout) detects providers from careers-page URL attributes before selecting parsers. These are architecture references, not dependencies or guarantees that every tenant endpoint works without access limits.

## Output Quality Controls
- API/feed-first extraction per adapter.
- Global normalization removes empty/null values.
- URL canonicalization removes tracking params before dedupe (`utm_*`, `gclid`, `fbclid`, etc.).
- Dedupe key combines platform + ID + canonical URL + title/company signature.
- Required output guard: records without `title` or `url` are discarded.

## Request Pattern Summary
- Single-request boards: Lever, Greenhouse, Ashby, Recruitee, BambooHR, JazzHR, Jobvite, Pinpoint, Rippling.
- Paginated boards: SmartRecruiters (offset), Workable fallback (cursor), Workday (offset + dynamic limit), Manatal (page number), Taleo (page number).
- Multi-endpoint probing boards: TeamTailor, Taleo JSON/RSS, iCIMS, Workday candidate CXS paths.
- Detail fan-out boards for richer data: BambooHR, SmartRecruiters, Workday.
- Custom-domain detection: fetched ATS links, known endpoint path patterns, vendor embed markers, and distinctive prefetched JSON schemas.
- If page markup links to a same-origin API URL, discovery probes at most four likely JSON endpoints and passes recognized rows to the matching adapter. Provider signatures include distinctive Lever, Greenhouse, Ashby, Recruitee, BambooHR, BreezyHR, SmartRecruiters, Workable, Workday, Personio, TeamTailor, Pinpoint, Rippling, and Manatal fields; generic `title`/`location` records are not treated as an ATS fingerprint.
- Prefetched rows use each adapter's expected response shape, so custom-domain JSON detection can produce normalized records without requiring the provider name in the submitted URL.

## API-First Enforcement
- Platform adapters always start with public JSON/XML/RSS endpoints.
- HTML page requests are limited to ATS discovery and feed-ID bootstrap; listing extraction uses public JSON/XML/RSS endpoints.
- Non-empty platform-specific fields are preserved during normalization to keep outputs rich.
