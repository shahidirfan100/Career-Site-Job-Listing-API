# API Discovery Notes

## Scope
- Goal: keep extraction API/feed-first for all supported ATS platforms.
- HTML parsing is optional and only used as detail fallback when `allow_html_detail_fallback=true` for `breezyhr`, `icims`, and `taleo`.
- Input supports multi-board runs using `startUrls`.

## Input Contract
- `startUrls`: array of one or more career board URLs.
- `results_wanted`: max total jobs returned after normalization/dedupe.
- `max_pages`: paging safety cap for paginated APIs.
- `allow_html_detail_fallback`: enriches missing descriptions only for BreezyHR/iCIMS/Taleo.

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
- Request: `GET https://{slug}.bamboohr.com/careers/list`
- Pattern: single list response
- Rich fields: `jobOpeningDescription`, `employmentStatusLabel`, `departmentLabel`, location object

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
- Detect: `{slug}.teamtailor.com`, compatible `careers.{slug}.com`
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
- Detect: `{slug}.jazz.co`
- Request: `GET https://{slug}.jazz.co/api/recruiting/jobs`
- Pattern: single list response
- Rich fields: `job_description`, `board_code_url`, `department`, location parts

### iCIMS
- Detect: `careers-*.icims.com`, `careers.*.icims.com`, related host variants
- Requests:
  - `GET {origin}/sitemap.xml`
  - fallback `GET {origin}/jobs/sitemap.xml`
  - fallback `GET {origin}/sitemap_index.xml`
- Pattern: XML feed discovery across origin candidates
- Rich fields:
  - feed gives stable job URLs and update dates
  - optional detail fallback adds description text

### Taleo
- Detect: `*.taleo.net/careersection/{section}`
- Requests:
  - `GET https://{host}/careersection/feed/joblist.rss?lang=en&locale=en`
  - section variants with `portal={section}` and `searchtype=2`
- Pattern: candidate RSS feed probing
- Rich fields:
  - feed provides title/url/date baseline
  - optional detail fallback enriches description

## Output Quality Controls
- API/feed-first extraction per adapter.
- Global normalization removes empty/null values.
- URL canonicalization removes tracking params before dedupe (`utm_*`, `gclid`, `fbclid`, etc.).
- Dedupe key combines platform + ID + canonical URL + title/company signature.
- Required output guard: records without `title` or `url` are discarded.

## Request Pattern Summary
- Single-request boards: Lever, Greenhouse, Ashby, Recruitee, BambooHR, JazzHR.
- Paginated boards: SmartRecruiters (offset), Workable fallback (cursor), Workday (offset + dynamic limit).
- Multi-endpoint probing boards: TeamTailor, Taleo, iCIMS, Workday candidate CXS paths.
- Detail fan-out boards for richer data: SmartRecruiters, Workday.

## API-First Enforcement
- Platform adapters always start with public JSON/XML/RSS endpoints.
- Optional HTML detail fallback is strictly scoped and disabled by default.
- Non-empty platform-specific fields are preserved during normalization to keep outputs rich.
