## Purpose

This file gives AI coding agents the minimal, actionable context needed to work productively in the jrecruits repo.

**Overview**

- The project is a static marketing/site + job listing served from Cloudflare Workers.
- Entry: `wrangler.jsonc` — Worker main is `src/index.js` which proxies requests to the `public` directory via the `ASSETS` binding.
- Static UI files: `public/` (HTML, CSS, images, client JS). No separate backend or API in this repo.

**Key files to inspect first**

- `wrangler.jsonc` — Cloudflare worker config (assets directory and `main`).
- `src/index.js` — Worker code: simple pass-through to `env.ASSETS.fetch(...)`.
- `public/index.html`, `public/jobs.html`, `public/job-detail.html` — primary HTML pages and inline client JS.
- `public/styles.css` — global styling and design system variables.

**Big-picture architecture & why**

- Static-first site: all content, UI state, and job data are client-side. The Worker is only used to serve the `public` assets via the `ASSETS` binding (see `src/index.js`).
- No server-side rendering, no Node backend or database in this repo — changes to content/data are edits to files under `public/`.

**Developer workflows — commands and how to test locally**

- Quick local preview (static-only): run a local static server from project root:

```bash
cd /path/to/jrecruits
python3 -m http.server 8000
# then open http://localhost:8000/public/index.html
```

- Cloudflare Worker dev / deploy (recommended to replicate production behavior): install Wrangler and use:

```bash
# run locally (requires wrangler and Cloudflare account setup)
wrangler dev

# publish
wrangler publish
```

**Project-specific conventions & patterns**

- Assets and routing: static assets live in `public/`; many image URLs are absolute-root (e.g. `/assets/logo_nav.png`) — the Worker relies on the `ASSETS` binding to serve these.
- Client-side JS is inline in HTML files. Example: `const jobs = { ... }` lives inside `public/job-detail.html` (search for `const jobs =`) — job data is edited directly in that file.
- Modal and UI conventions: modal state and navigation are controlled by small, global functions like `openModal('hiringModal')`, `closeModal(...)`, and `toggleMenu()` implemented inline in `public/index.html` and `public/jobs.html`.
- Forms: submissions use an external form service (see form `action` attributes like `https://submit-form.com/...`) and include `_redirect` to `https://jrecruits.com/thanks.html`. Do not assume internal form handlers.

**Integration points & external dependencies**

- Cloudflare Workers (via `wrangler.jsonc`/`wrangler` CLI) — assets served through `ASSETS` binding.
- External form endpoints: `https://submit-form.com/*` are used for candidate/employer contact forms and redirects to `thanks.html`.
- No package.json, build toolchain, or tests are present — code edits are file-level.

**Editing guidelines for AI agents (concrete rules)**

- Preserve the `ASSETS.fetch` behavior in `src/index.js`. If you change the worker entrypoint, update `wrangler.jsonc` accordingly.
- When adding or modifying job data, prefer editing `public/job-detail.html`'s `jobs` object (it is the single source-of-truth here).
- If changing a form `action`, keep `_redirect` behavior and confirm the external endpoint supports the same fields (do not swap endpoints silently).
- Keep relative links consistent: pages link to `index.html`, `jobs.html`, and `job-detail.html?id=...` — keep that URL scheme unless you update all references.
- Avoid moving large inline scripts into separate bundlers unless you introduce a build manifest and update `wrangler.jsonc` accordingly (there is no bundler config today).

**Examples (copyable references from the codebase)**

- Worker main: `wrangler.jsonc` -> `main: "src/index.js"` and `src/index.js` uses `env.ASSETS.fetch(new Request(url.toString(), request))`.
- Static job data: `const jobs = { '1': { title: 'Senior Frontend Engineer', ... } }` inside `public/job-detail.html`.
- Form example: `<form id="contractForm" action="https://submit-form.com/z6W0WdCa4" method="POST">` in `public/index.html`.
- Modal example: `openModal('contractModal')` is used across pages to open overlays.

**What not to assume**

- There is no server-side API or database in this repo — do not introduce server-side changes without adding a clear deployment plan.
- There are no tests or CI defined — any change that requires build steps must include updated `wrangler` config and a README with developer commands.

If anything above is unclear or you'd like the instructions to include direct examples of edits (for instance, a small change to `public/job-detail.html`), tell me which area and I will update this file accordingly.
