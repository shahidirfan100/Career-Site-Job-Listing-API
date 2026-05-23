# Career Site Job Listing Scraper

Extract job listings from major ATS career platforms using a single `startUrl`. Collect clean, structured, and rich job records for sourcing, research, monitoring, and automation workflows.

## Features

- **Multi-platform coverage** — One actor supports Lever, Greenhouse, Ashby, SmartRecruiters, Workable, Recruitee, BreezyHR, BambooHR, Workday, TeamTailor, Personio, JazzHR, iCIMS, and Taleo.
- **Automatic platform detection** — Provide a career page URL and the actor routes to the right extraction flow.
- **Rich output fields** — Includes job ID, title, company, location parts, team/department, job type, dates, links, and platform metadata when available.
- **Clean dataset quality** — Removes duplicate records and skips null/empty values for cleaner downstream use.
- **Flexible configuration** — Supports result count and paging caps.

## Use Cases

### Sourcing and Recruiting
Build company-specific job datasets directly from employer career systems for recruiter outreach, market mapping, and role tracking.

### Competitive Hiring Intelligence
Track hiring activity across competitors by platform, location, and role family without manually checking each career site.

### Job Alert Automation
Schedule runs and push fresh roles into your CRM, Airtable, Slack, email digests, or webhooks.

### Talent Market Research
Analyze demand trends by title, location, function, and employment type using normalized multi-platform output.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | Yes | — | Career board URL for one supported ATS platform. |
| `results_wanted` | Integer | No | `20` | Maximum jobs to save. |
| `max_pages` | Integer | No | `5` | Page/offset safety cap for paginated sources. |
| `proxyConfiguration` | Object | No | — | Optional Apify proxy settings. |

---

## Supported Job Boards

| Platform | Typical URL Format | Example |
|---|---|---|
| Lever | `https://jobs.lever.co/{company}` | `https://jobs.lever.co/spotify` |
| Greenhouse | `https://job-boards.greenhouse.io/{company}` | `https://job-boards.greenhouse.io/airbnb` |
| Ashby | `https://jobs.ashbyhq.com/{company}` | `https://jobs.ashbyhq.com/vercel` |
| SmartRecruiters | `https://careers.smartrecruiters.com/{company}` | `https://careers.smartrecruiters.com/Visa` |
| Workable | `https://apply.workable.com/{company}/` | `https://apply.workable.com/evidence-action/` |
| TeamTailor | `https://{company}.teamtailor.com/` or `https://careers.{company}.com/` | `https://careers.kognity.com/` |
| BreezyHR | `https://{company}.breezy.hr/` | `https://breezy-hr.breezy.hr/` |
| BambooHR | `https://{company}.bamboohr.com/careers/` | `https://bamboohr.bamboohr.com/careers/` |
| Recruitee | `https://{company}.recruitee.com/` | `https://recruitee.recruitee.com/` |
| Workday | `https://{company}.wdN.myworkdayjobs.com/{board}` | `https://sony.wd1.myworkdayjobs.com/SonyCareers` |
| Personio | `https://{company}.jobs.personio.de/` | `https://company.jobs.personio.de/` |
| JazzHR | `https://{company}.jazz.co/` | `https://example.jazz.co/` |
| iCIMS | `https://careers-{company}.icims.com/` | `https://careers-kloveair1.icims.com/jobs/search?ss=1` |
| Taleo | `https://{company}.taleo.net/careersection/{section}/jobsearch.ftl` | `https://nato.taleo.net/careersection/2/jobsearch.ftl?lang=en` |

---

## Find Company Boards with Google

If you want to find companies for a single platform quickly, use these search commands:

| Platform | Google Search Command |
|---|---|
| Lever | `site:jobs.lever.co "Job Title"` |
| Greenhouse | `site:boards.greenhouse.io "Job Title"` |
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

---

## Output Data

Each dataset item can include:

| Field | Type | Description |
|---|---|---|
| `job_id` | String | Platform job identifier when available. |
| `title` | String | Job title. |
| `company` | String | Company or tenant name. |
| `location` | String | Human-readable location string. |
| `city` | String | City when available. |
| `state` | String | State/region when available. |
| `country` | String | Country when available. |
| `department` | String | Department or function. |
| `team` | String | Team name when provided. |
| `job_type` | String | Employment type. |
| `workplace_type` | String | On-site/remote/hybrid style when provided. |
| `date_posted` | String | Posting date (`YYYY-MM-DD`) when available. |
| `updated_at` | String | Updated date when available. |
| `url` | String | Public job URL. |
| `apply_url` | String | Apply URL. |
| `description` | String | Job description text when available. |
| `remote` | Boolean/String | Remote marker where provided by source. |
| `platform` | String | Detected ATS platform key. |
| `source_host` | String | Source hostname derived from `url`. |
| `scraped_at` | String | Extraction timestamp in ISO format. |

---

## Usage Examples

### Lever Example

```json
{
    "startUrl": "https://jobs.lever.co/spotify",
    "results_wanted": 20
}
```

### Workday Example

```json
{
    "startUrl": "https://sony.wd1.myworkdayjobs.com/SonyCareers",
    "results_wanted": 30,
    "max_pages": 8
}
```

### Workable Example

```json
{
    "startUrl": "https://apply.workable.com/careers/",
    "results_wanted": 25,
    "max_pages": 3
}
```

---

## Sample Output

```json
{
    "job_id": "58860a10-4a0d-4a21-a495-1f3605b300c1",
    "title": "Backend Engineer - User Platform",
    "company": "spotify",
    "location": "Toronto",
    "department": "Engineering",
    "workplace_type": "remote",
    "date_posted": "2026-01-16",
    "url": "https://jobs.lever.co/spotify/58860a10-4a0d-4a21-a495-1f3605b300c1",
    "apply_url": "https://jobs.lever.co/spotify/58860a10-4a0d-4a21-a495-1f3605b300c1/apply",
    "description": "User Platform is responsible for...",
    "platform": "lever",
    "source_host": "jobs.lever.co",
    "scraped_at": "2026-05-23T10:12:34.567Z"
}
```

---

## Tips for Best Results

### Use canonical career board URLs
- Start from the platform-native board URL (for example `jobs.lever.co/{company}`).
- Avoid redirect-heavy marketing pages when possible.

### Start with small runs first
- Use `results_wanted: 20` for quick validation.
- Increase limits after confirming data quality.

### Handle platform variability
- Some example company slugs on public lists may be outdated or renamed.
- If a board returns zero results, test another company URL for that platform.

---

## Integrations

Connect dataset output with:

- **Google Sheets** — Operational tracking and reporting
- **Airtable** — Searchable talent opportunity database
- **Slack** — Job alert channels
- **Webhooks** — Push records into custom pipelines
- **Make** — No-code automation flows
- **Zapier** — Trigger downstream actions

### Export Formats

- **JSON** — API and application use
- **CSV** — Spreadsheet workflows
- **Excel** — Business sharing
- **XML** — Legacy integrations

---

## Frequently Asked Questions

### Why do some boards return zero jobs?
Some public examples go stale, change slugs, or disable public listings. Use the Google search commands above to find fresh company board URLs.

### Does one input work for all platforms?
Yes. Use `startUrl` and the actor auto-detects the platform.

### Are duplicate records removed?
Yes. The actor deduplicates by platform, ID/link, title, and company before saving.

### Can I run this on a schedule?
Yes. Schedule runs in Apify and consume only latest dataset items.

---

## Support

For issues or feature requests, open the actor issue thread in Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

Use this actor only for lawful data collection and in compliance with platform terms and applicable regulations.
