# API Discovery Notes

## Scope
- Goal: keep extraction API/feed-first for all supported ATS boards.
- HTML parsing is optional and only used as detail fallback when `allow_html_detail_fallback=true` for `breezyhr`, `icims`, and `taleo`.
- Input now supports multi-board runs using `startUrls` (string list array).

## Input Contract
- `startUrls`: array of one or more career board URLs.
- `results_wanted`: max total jobs returned after normalization/dedupe.
- `max_pages`: paging safety cap for paginated APIs.
- `allow_html_detail_fallback`: enriches missing descriptions only for BreezyHR/iCIMS/Taleo.

## Board-by-Board API Discovery and Request Flow

### Lever
- Detect: `jobs.lever.co/{slug}`
- Request: `GET https://api.lever.co/v0/postings/{slug}?mode=json`
- Notes: single JSON response with rich fields (title, team, location, description, apply URL).

### Greenhouse
- Detect: `job-boards.greenhouse.io/{slug}` or `boards.greenhouse.io/{slug}`
- Request: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- Notes: includes content/body in one request.

### Ashby
- Detect: `jobs.ashbyhq.com/{slug}`
- Request: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`
- Notes: JSON board payload contains jobs and metadata.

### SmartRecruiters
- Detect: `careers.smartrecruiters.com/{slug}`
- Request: `GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit={limit}&offset={offset}`
- Notes: offset pagination.

### Workable
- Detect: `apply.workable.com/{slug}`
- Request: `POST https://apply.workable.com/api/v3/accounts/{slug}/jobs`
- Notes: cursor/token paging where available.

### Recruitee
- Detect: `{slug}.recruitee.com`
- Request: `GET https://{slug}.recruitee.com/api/offers`
- Notes: direct JSON offer list.

### BreezyHR
- Detect: `{slug}.breezy.hr`
- Request: `GET https://{slug}.breezy.hr/json`
- Detail fallback (optional): `GET` each job page URL if description is missing.
- Notes: API is primary; fallback only enriches missing text.

### BambooHR
- Detect: `{slug}.bamboohr.com`
- Request: `GET https://{slug}.bamboohr.com/careers/list`
- Notes: API/list endpoint used directly.

### Workday
- Detect: `{tenant}.wdN.myworkdayjobs.com/{board}`
- Requests:
  - `POST https://{host}/wday/cxs/{tenant}/{board}/jobs`
  - Follow-up detail requests per requisition URL when needed.
- Notes: richest normalized output due to list + detail fan-out.

### TeamTailor
- Detect: `{slug}.teamtailor.com` (and compatible `careers.*` domains)
- Requests:
  - `GET {origin}/jobs.json`
  - fallback `GET {origin}/api/jobs.json`
- Notes: JSON endpoint variants by tenant setup.

### Personio
- Detect: `{slug}.jobs.personio.de|com`
- Request: `GET https://{host}/api/v1/jobs?language=en`
- Notes: normalized from Personio JSON API payload.

### JazzHR
- Detect: `{slug}.jazz.co`
- Request: `GET https://{slug}.jazz.co/api/recruiting/jobs`
- Notes: public job API response.

### iCIMS
- Detect: `careers-*.icims.com` or `careers.*.icims.com`
- Requests:
  - `GET {origin}/sitemap.xml`
  - fallback `GET {origin}/jobs/sitemap.xml`
  - fallback `GET {origin}/sitemap_index.xml`
- Detail fallback (optional): `GET` each discovered job URL to enrich description.
- Notes: sitemap feed is used as API/feed source when no stable public JSON board API is available.

### Taleo
- Detect: `*.taleo.net/careersection/{section}`
- Requests:
  - `GET https://{host}/careersection/feed/joblist.rss?lang=en&locale=en`
  - Candidate variants include `portal={section}` and `searchtype=2`.
- Detail fallback (optional): `GET` each job URL when feed item description is missing.
- Notes: RSS feed is the most stable public structured source across tenants.

## Data Richness Summary
- Very High: Workday
- High: Lever, Greenhouse, Ashby, SmartRecruiters, Workable
- Medium: Recruitee, BambooHR, TeamTailor, Personio, JazzHR, Taleo
- Medium with fallback enrichment: BreezyHR, iCIMS, Taleo

## API-First Enforcement
- Platform adapters always start with public JSON/XML/RSS endpoints.
- Optional HTML detail fallback is strictly scoped and disabled by default.
- Non-empty platform-specific fields are preserved in normalization to keep outputs rich.
