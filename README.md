# JRecruits website → ERPNext intake

This repo serves the JRecruits marketing site from a Cloudflare Worker and routes form submissions into ERPNext so ERPNext acts as the system-of-record (“DB”) for:

- Candidate applications (with resume uploads)
- Job applications (with job title + links)
- Employer / hiring inquiries
 
In addition, submissions are forwarded to a secondary backup form collector (SubmitForm) so you still capture entries if ERPNext is degraded.

## How it works

- The static site lives in `public/` and is served by the Worker (`src/index.js`).
- All forms post to `POST /api/forms/submit`.
- If Turnstile is configured, the Worker validates the request.
- The Worker creates:
  - `Lead` + `Comment` for hiring/employer inquiries
  - `Job Applicant` + `Comment` for candidate/job applications
  - and uploads a resume (if provided) via `upload_file`, attached to the `Job Applicant`
- The Worker also posts the same payload to SubmitForm (best-effort) so you have a backup if ERPNext is degraded.

## Required Cloudflare Worker configuration

### Variables (non-secret)

- `ERPNEXT_BASE_URL` (example: `https://jrecruits.fedoratechnology.com`)
- `TURNSTILE_SITE_KEY` (optional; Turnstile widget site key if you choose to inject it into HTML)
- `ALLOWED_ORIGINS` (optional; comma-separated origins for CORS; use `*` to allow any)
- `ERPNEXT_LEAD_DOCTYPE` (optional; default `Lead`)
- `ERPNEXT_APPLICANT_DOCTYPE` (optional; default `Job Applicant`)

### Secrets

ERPNext API auth (pick one):

- `ERPNEXT_API_TOKEN` (format: `<api_key>:<api_secret>`)
  - OR `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET`

Turnstile (recommended):

- `TURNSTILE_SECRET` (if set, Turnstile verification is enforced)

Cloudflare Access (only if your ERPNext is protected by a service token):

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

## Deploy / update via Wrangler

Set secrets:

- `wrangler secret put ERPNEXT_API_TOKEN`
- `wrangler secret put TURNSTILE_SECRET`
- `wrangler secret put CF_ACCESS_CLIENT_ID` (optional)
- `wrangler secret put CF_ACCESS_CLIENT_SECRET` (optional)

Deploy:

- `wrangler deploy`

## Form kinds

Each form includes a hidden `form_kind` used by the Worker:

- `candidate_application` → `Job Applicant` (+ resume upload if provided)
- `job_application` → `Job Applicant` (captures `job_title`, `resumeUrl`, `coverLetter`)
- `employer_inquiry` → `Lead`
- `contract_inquiry` → `Lead`
- `fulltime_inquiry` → `Lead`

## Limits

- Resume uploads: max `10MB`
- Allowed resume types: `pdf`, `doc`, `docx`
