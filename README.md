## What does Career Site Job Listing API do?

Career Site Job Listing API collects public job listings from 18 supported applicant tracking systems. Add ATS board URLs or employer careers pages in `startUrls`; the Actor checks the URL, fetched page markup, embedded API paths, and distinctive job-data schemas to identify a supported platform, then returns normalized records.

Use it to build recruiting datasets, monitor competitor hiring, research labor markets, create job alerts, or feed structured job data into another application. Results are saved to an Apify dataset and can be downloaded or connected to downstream workflows.

## Why use Career Site Job Listing API?

- **One input format for many platforms** - Collect jobs from multiple ATS providers in the same run.
- **Company-specific hiring data** - Start with the public career board URL for the employer you want to monitor.
- **Employer-page discovery** - Supply a company careers page when ATS details appear in links, page scripts, API paths, or recognizable embedded job data.
- **Useful normalized records** - Compare job titles, locations, departments, employment types, dates, and links across different sources.
- **Flexible collection size** - Set the number of records and pages to collect without a fixed Actor ceiling.
- **Duplicate-safe datasets** - Repeated records are removed before they are saved.
- **Automation-ready output** - Use Apify schedules, webhooks, API access, and dataset exports for recurring workflows.

## What data can you extract from employer career sites?

The Actor keeps non-empty fields from each public listing. Availability depends on what the employer publishes on its career board.

| Field | Type | Description |
|---|---|---|
| `job_id` | String | Platform job identifier when available. |
| `title` | String | Job title. |
| `company` | String | Employer, tenant, or organization name. |
| `location` | String | Human-readable location from the listing. |
| `city` | String | City when available. |
| `state` | String | State, province, or region when available. |
| `country` | String | Country when available. |
| `department` | String | Department or function. |
| `team` | String | Team name when published. |
| `job_type` | String | Employment or contract type. |
| `workplace_type` | String | Remote, hybrid, on-site, or another workplace label when available. |
| `remote` | Boolean | Remote indicator when the source provides a clear value. |
| `remote_type` | String | Remote or workplace text when it cannot be represented as a Boolean. |
| `date_posted` | String | Posting date when available. |
| `updated_at` | String | Updated date when available. |
| `url` | String | Public job detail URL. |
| `apply_url` | String | Application URL. |
| `description` | String | Job description text when available. |
| `platform` | String | Detected ATS platform key, such as `lever` or `workday`. |
| `source_host` | String | Hostname of the public source URL. |
| `scraped_at` | String | ISO timestamp for the collection time. |

Some Workday listings can also include fields such as `job_family` and `salary` when those values are published by the employer.

## How to use Career Site Job Listing API

1. Open the Actor on Apify Store.
2. Add one or more supported employer career board URLs to `startUrls`.
3. Set `results_wanted` and `max_pages` for the size of the collection.
4. Add optional proxy settings when needed.
5. Run the Actor and review the dataset preview.
6. Export the results or connect the dataset to your recruiting, research, or alerting workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrls` | Array<String> | Yes | — | One or more public ATS board URLs or employer career pages. The Actor inspects fetched markup and data for supported ATS signals. |
| `results_wanted` | Integer | No | `20` | Maximum number of job records to save across the run; no fixed upper limit is imposed by the Actor. |
| `max_pages` | Integer | No | `5` | Maximum number of API pages to fetch per paginated board; no fixed upper limit is imposed by the Actor. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional Apify Proxy settings. |

Provide at least one URL in `startUrls`. The Actor returns listings from the supplied boards without keyword, location, or posting-date filters. It does not include a global company-and-board index for searching across every ATS. A custom-domain careers page can still be detected when its fetched markup or embedded data contains a supported platform fingerprint. Generic job data without a distinctive ATS signal is not enough to identify a provider reliably.

## Supported Job Boards

The examples below were checked against the platform adapters. A board can return fewer records later if the employer closes positions or changes its public feed.

| Platform | Typical URL format | Example board |
|---|---|---|
| Ashby | `https://jobs.ashbyhq.com/{company}` | `https://jobs.ashbyhq.com/seamflow` |
| BambooHR | `https://{company}.bamboohr.com/careers/` | `https://flyio.bamboohr.com/careers` |
| BreezyHR | `https://{company}.breezy.hr/` | `https://renewco2.breezy.hr/` |
| Greenhouse | `https://job-boards.greenhouse.io/{company}` | `https://job-boards.greenhouse.io/airbnb` |
| iCIMS | `https://careers-{company}.icims.com/jobs/search` | `https://careers-rambus.icims.com/jobs/search?ss=1` |
| JazzHR | `https://{company}.jazz.co/` or a public JazzHR feed URL | `https://app.jazz.co/feeds/export/jobs/Riverdale` |
| Jobvite | `https://jobs.jobvite.com/{company}` | `https://jobs.jobvite.com/enverus/jobs` |
| Lever | `https://jobs.lever.co/{company}` | `https://jobs.lever.co/spotify` |
| Manatal | `https://www.careers-page.com/{company}` | `https://www.careers-page.com/manatal` |
| Personio | `https://{company}.jobs.personio.de/` or `.jobs.personio.com/` | `https://detax-gmbh-1.jobs.personio.de/` |
| Pinpoint | `https://{company}.pinpointhq.com/` | `https://workwithus.pinpointhq.com/` |
| Recruitee | `https://{company}.recruitee.com/` | `https://helloprint.recruitee.com/` |
| Rippling | `https://ats.rippling.com/{company}/jobs` | `https://ats.rippling.com/legitscript-careers/jobs` |
| SmartRecruiters | `https://careers.smartrecruiters.com/{company}` | `https://careers.smartrecruiters.com/Leger2` |
| Taleo | `https://{company}.taleo.net/careersection/{section}/jobsearch.ftl` | `https://drhorton.taleo.net/careersection/2/jobsearch.ftl?lang=en` |
| TeamTailor | `https://{company}.teamtailor.com/` | `https://flower.teamtailor.com/` |
| Workable | `https://apply.workable.com/{company}/` | `https://apply.workable.com/hi-jobs/` |
| Workday | `https://{company}.wdN.myworkdayjobs.com/{board}` | `https://workday.wd5.myworkdayjobs.com/en-US/Workday` |

**Taleo data:** The adapter uses the public JSON job-search endpoint exposed by the supplied career section and paginates up to `max_pages`. Career sections choose their own visible columns; the Actor maps a field only when its heading can be matched safely, so department or employment type may be empty for boards that do not publish those columns. A limited RSS fallback is available for sections whose JSON endpoint cannot be read, but Oracle documents that RSS is optional, off by default, and limited to 10 jobs per feed ([Oracle documentation](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22b/otcug/c-rssfeature.html)).

## Find Company Boards with Google

If you want to find company career boards for a specific platform, search Google with one of the following commands. Replace `Job Title` with a role, skill, or keyword.

| Platform | Google search command |
|---|---|
| Lever | `site:jobs.lever.co "Job Title"` |
| Greenhouse | `site:job-boards.greenhouse.io "Job Title"` |
| Workday | `site:myworkdayjobs.com "Job Title"` |
| Ashby | `site:jobs.ashbyhq.com "Job Title"` |
| SmartRecruiters | `site:smartrecruiters.com "Job Title"` |
| Workable | `site:apply.workable.com "Job Title"` |
| TeamTailor | `site:teamtailor.com "Job Title"` |
| BreezyHR | `site:breezy.hr "Job Title"` |
| BambooHR | `site:bamboohr.com/careers "Job Title"` |
| Recruitee | `site:recruitee.com "Job Title"` |
| Personio | `site:jobs.personio.de "Job Title"` |
| JazzHR | `site:jazz.co "Job Title"` |
| iCIMS | `site:icims.com/jobs/search "Job Title"` |
| Taleo | `site:taleo.net/careersection "Job Title"` |
| Jobvite | `site:jobs.jobvite.com "Job Title"` |
| Pinpoint | `site:pinpointhq.com "Job Title"` |
| Rippling | `site:ats.rippling.com "Job Title"` |
| Manatal | `site:careers-page.com "Job Title"` |

After finding a public board, copy its URL into `startUrls`. The Actor also checks supported ATS links, embedded endpoints, vendor markers, and distinctive job-data schemas on the supplied employer careers page.

## Usage Examples

### Basic single-board collection

Collect up to 20 public listings from one Lever career board:

```json
{
  "startUrls": [
    "https://jobs.lever.co/spotify"
  ],
  "results_wanted": 20
}
```

### Multiple employer boards

Collect from several supported ATS platforms in one run and allow more pagination:

```json
{
  "startUrls": [
    "https://jobs.lever.co/spotify",
    "https://job-boards.greenhouse.io/airbnb",
    "https://careers-rambus.icims.com/jobs/search?ss=1"
  ],
  "results_wanted": 60,
  "max_pages": 8
}
```

### Larger collection with a page cap

Increase the result limit and page safety cap for a broader collection:

```json
{
  "startUrls": [
    "https://workday.wd5.myworkdayjobs.com/en-US/Workday"
  ],
  "results_wanted": 100,
  "max_pages": 10
}
```

## Sample Output

```json
{
  "job_id": "58860a10-4a0d-4a21-a495-1f3605b300c1",
  "title": "Backend Engineer - User Platform",
  "company": "Example Technology Company",
  "location": "Toronto, Ontario, Canada",
  "city": "Toronto",
  "state": "Ontario",
  "country": "Canada",
  "department": "Engineering",
  "job_type": "Full-time",
  "workplace_type": "Remote",
  "remote": true,
  "date_posted": "2026-01-16",
  "url": "https://jobs.lever.co/example-company/58860a10-4a0d-4a21-a495-1f3605b300c1",
  "apply_url": "https://jobs.lever.co/example-company/58860a10-4a0d-4a21-a495-1f3605b300c1/apply",
  "description": "Build services for the user platform and work with product and engineering teams.",
  "platform": "lever",
  "source_host": "jobs.lever.co",
  "scraped_at": "2026-08-07T10:12:34.567Z"
}
```

## Tips for Best Results

- **Use the canonical board URL** - Start with the ATS-hosted career board instead of a redirect-heavy company careers page.
- **Test with a small limit** - Begin with `results_wanted: 20` and increase the limit after reviewing the dataset.
- **Increase pages gradually** - Raise `max_pages` for larger collections, especially when the board has many listings.
- **Check source availability** - Missing salary, department, location, or date values usually mean the employer did not publish them.
- **Keep scheduled runs consistent** - Reuse the same URLs and collection limits when comparing hiring activity over time.
- **Use proxy settings for scale** - Configure Apify Proxy for larger or recurring collections when the target requires it.

## Integrations and Export Formats

- **Google Sheets** - Review job datasets, assign research tasks, and share hiring reports.
- **Airtable** - Create a searchable recruiting or competitor-monitoring database.
- **Slack** - Send alerts when a scheduled run completes.
- **Webhooks** - Forward completed-run events to your own systems.
- **Make or Zapier** - Connect new job records to no-code workflows.
- **API** - Read datasets programmatically from an application or data pipeline.

Apify datasets can be exported as JSON, CSV, Excel, XML, and other supported formats.

## Frequently Asked Questions

### Can I collect jobs from more than one ATS platform in one run?

Yes. Add multiple public career board URLs to `startUrls`. The Actor identifies each supported platform and combines the resulting records up to `results_wanted`.

### Can I collect from one career board?

Yes. Add one URL as the only item in the `startUrls` array.

### Can it detect an ATS on a company-branded careers URL?

Often. The Actor checks the fetched page for ATS API paths, vendor embed markers, and distinctive job-data fields, even when the provider name is absent from the URL. Pages with only generic job fields cannot identify a provider reliably.

### Does the Actor filter jobs by keyword, location, or posting date?

No. The Actor collects the listings returned by the URLs you provide. It does not apply keyword, location, or posting-date filters. Searching all providers from a query requires a maintained company/board catalog and indexed job store, which this URL-based Actor does not include.

### Why are some fields missing?

Some employers do not publish every job attribute. The Actor removes empty values, so a record may omit salary, team, department, dates, or detailed location when the source does not provide them.

### Are duplicate listings removed?

Yes. Records are normalized and deduplicated using available platform identifiers, URLs, titles, and company values before they are saved.

### Can I run the Actor on a schedule?

Yes. Create an Apify schedule to run hourly, daily, weekly, or at another interval for recurring hiring monitoring.

### Can I export the results to CSV or Excel?

Yes. Apify datasets support JSON, CSV, Excel, XML, and other export formats.

### Is it legal to collect public job listings?

Public data collection may be subject to website terms, applicable laws, privacy requirements, and access restrictions. You are responsible for using the Actor lawfully and respecting each source's rules.

## Related Actors

- [APEC Jobs Scraper](https://apify.com/shahidirfan/apec-jobs-scraper) - Collect French executive and professional job listings for regional hiring research.
- [USA Jobs Scraper](https://apify.com/shahidirfan/usa-jobs-scraper) - Gather structured federal job data from USAJobs.gov.
- [Workday Job Scraper](https://apify.com/shahidirfan/workday-job-scraper) - Focus on job listings from Workday career sites.
- [Michaelpage Jobs Scraper](https://apify.com/shahidirfan/michaelpage-jobs-scraper) - Collect listings from the Michael Page employment network.

## Support

For issues, feature requests, or source-specific problems, use the Issues tab on the Actor page in Apify Console.

## Legal Notice

This Actor is intended for legitimate collection of publicly available career information. Users are responsible for complying with applicable laws, website terms, privacy requirements, and any access restrictions.
