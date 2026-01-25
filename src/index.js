export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/__ping") {
      return new Response("pong", { status: 200 });
    }

    if (url.pathname === "/api/forms/submit" || url.pathname === "/api/forms/submit/") {
      return handleFormSubmit(request, env, ctx);
    }

    const assetResponse = await fetchStaticAsset(request, env, ctx);
    return maybeRewriteHtml(assetResponse, env);
  },
};

const SUBMIT_FORM_FALLBACK_URLS = {
  contract_inquiry: "https://submit-form.com/z6W0WdCa4",
  fulltime_inquiry: "https://submit-form.com/GFMlEZkHU",
  employer_inquiry: "https://submit-form.com/U3KGFXX3r",
  candidate_application: "https://submit-form.com/sTQw7tXEo",
  job_application: "https://submit-form.com/OZ6pQJeYU",
};

function withCors(request, env, response) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAny = allowed.length === 0 || allowed.includes("*");
  const allowOrigin = allowAny ? "*" : allowed.includes(origin) ? origin : "";

  const headers = new Headers(response.headers);
  if (allowOrigin) headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchStaticAsset(request, env) {
  const url = new URL(request.url);

  // Serve root index.
  if (url.pathname === "/") {
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }

  // Handle common routes without the .html extension.
  const routes = ["/index", "/jobs", "/thanks", "/employers", "/job-detail"];
  if (routes.includes(url.pathname)) {
    url.pathname = `${url.pathname}.html`;
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }

  // If a request path has no extension, try "<path>.html" before 404ing.
  if (!url.pathname.includes(".") && url.pathname !== "/") {
    const htmlUrl = new URL(url);
    htmlUrl.pathname = `${url.pathname}.html`;
    const response = await env.ASSETS.fetch(new Request(htmlUrl.toString(), request));
    if (response.status !== 404) return response;
  }

  return env.ASSETS.fetch(request);
}

function isHtmlResponse(response) {
  const ct = response.headers.get("content-type") || "";
  return ct.toLowerCase().includes("text/html");
}

async function maybeRewriteHtml(response, env) {
  if (!isHtmlResponse(response)) return response;

  const siteKey = String(env.TURNSTILE_SITE_KEY || "");
  const text = await response.text();
  const rewritten = text.replaceAll("__TURNSTILE_SITE_KEY__", siteKey);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(rewritten, { status: response.status, headers });
}

async function handleFormSubmit(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return withCors(
      request,
      env,
      new Response(null, {
        status: 204,
      }),
    );
  }

  if (request.method !== "POST") {
    return withCors(
      request,
      env,
      new Response("Method Not Allowed", { status: 405 }),
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let form;
  try {
    if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      form = await request.formData();
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      form = new Map(Object.entries(body || {}));
    } else {
      return withCors(
        request,
        env,
        new Response("Unsupported Content-Type", { status: 415 }),
      );
    }
  } catch {
    return withCors(request, env, new Response("Bad Request", { status: 400 }));
  }

  const get = (k) => (form instanceof Map ? form.get(k) : form.get(k));
  const formKind = String(get("form_kind") || "").trim();
  const redirectPath = String(get("_redirect") || "/thanks").trim() || "/thanks";

  // Turnstile (optional but recommended; enforced when TURNSTILE_SECRET is set)
  const tsSecret = String(env.TURNSTILE_SECRET || "");
  if (tsSecret) {
    const token = String(get("cf-turnstile-response") || "").trim();
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ok = await verifyTurnstile(tsSecret, token, ip);
    if (!ok) {
      return withCors(
        request,
        env,
        new Response("Turnstile verification failed", { status: 400 }),
      );
    }
  }

  let erpOk = false;
  let backupOk = false;

  try {
    backupOk = await submitToSubmitFormFallback(formKind, form, contentType);
  } catch (err) {
    console.error("backup_form_submit_error", err);
  }

  // Always attempt ERPNext so ERPNext is the system-of-record for staff.
  // If backup succeeded, do ERPNext in the background to keep UX fast.
  if (backupOk && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(
      submitToErpNext(env, request, formKind, form).catch((err) => {
        console.error("erp_form_submit_error", err);
      }),
    );
    erpOk = true;
  } else {
    try {
      await submitToErpNext(env, request, formKind, form);
      erpOk = true;
    } catch (err) {
      console.error("erp_form_submit_error", err);
    }
  }

  if (!erpOk && !backupOk) {
    return withCors(request, env, new Response("Failed to submit form", { status: 502 }));
  }

  const redirectUrl = new URL(redirectPath, request.url).toString();
  return withCors(request, env, Response.redirect(redirectUrl, 303));
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (ip) params.set("remoteip", ip);

  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!resp.ok) return false;
  const data = await resp.json().catch(() => null);
  return Boolean(data && data.success);
}

function cloneFormData(form) {
  const fd = new FormData();
  if (form instanceof Map) {
    for (const [k, v] of form.entries()) fd.append(k, String(v ?? ""));
    return fd;
  }
  for (const [k, v] of form.entries()) fd.append(k, v);
  return fd;
}

function asUrlEncoded(form) {
  const params = new URLSearchParams();
  if (form instanceof Map) {
    for (const [k, v] of form.entries()) params.append(k, String(v ?? ""));
    return params;
  }
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params.append(k, v);
  }
  return params;
}

async function submitToSubmitFormFallback(formKind, form, contentType) {
  const kind = String(formKind || "").trim();
  if (!kind) throw new Error("Missing form_kind");

  const url = SUBMIT_FORM_FALLBACK_URLS[kind];
  if (!url) return false;

  let body;
  let headers = undefined;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = asUrlEncoded(form);
    headers = { "content-type": "application/x-www-form-urlencoded" };
  } else if (contentType.includes("application/json") && form instanceof Map) {
    body = JSON.stringify(Object.fromEntries(form.entries()));
    headers = { "content-type": "application/json" };
  } else {
    body = cloneFormData(form);
  }

  // Backwards-compat for historical field naming on Contract Project.
  if (kind === "contract_inquiry" && body instanceof FormData) {
    if (!body.has("message-textarea") && body.has("message")) {
      body.append("message-textarea", String(body.get("message") || ""));
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers,
    body,
  });

  return resp.status >= 200 && resp.status < 400;
}

function erpAuthHeaders(env) {
  const headers = new Headers();

  const baseToken = String(env.ERPNEXT_API_TOKEN || "").trim();
  const key = String(env.ERPNEXT_API_KEY || "").trim();
  const secret = String(env.ERPNEXT_API_SECRET || "").trim();

  const token = baseToken || (key && secret ? `${key}:${secret}` : "");
  if (!token) throw new Error("Missing ERPNext API credentials");

  headers.set("Authorization", `token ${token}`);

  const cfId = String(env.CF_ACCESS_CLIENT_ID || "").trim();
  const cfSecret = String(env.CF_ACCESS_CLIENT_SECRET || "").trim();
  if (cfId && cfSecret) {
    headers.set("CF-Access-Client-Id", cfId);
    headers.set("CF-Access-Client-Secret", cfSecret);
  }

  return headers;
}

function erpBaseUrl(env) {
  const base = String(env.ERPNEXT_BASE_URL || "").trim();
  if (!base) throw new Error("Missing ERPNEXT_BASE_URL");
  return base.replace(/\/$/, "");
}

async function erpCreateResource(env, doctype, doc) {
  const base = erpBaseUrl(env);
  const headers = erpAuthHeaders(env);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  const resp = await fetch(`${base}/api/resource/${encodeURIComponent(doctype)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(doc),
  });

  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = json?.exception || json?.message || text || `HTTP ${resp.status}`;
    throw new Error(`ERP create ${doctype} failed: ${msg}`);
  }

  return json?.data || json;
}

async function erpUploadFile(env, { file, doctype, docname, isPrivate = true }) {
  const base = erpBaseUrl(env);
  const headers = erpAuthHeaders(env);
  headers.set("accept", "application/json");

  const fd = new FormData();
  fd.append("is_private", isPrivate ? "1" : "0");
  fd.append("doctype", doctype);
  fd.append("docname", docname);
  fd.append("file", file, file.name || "resume");

  const resp = await fetch(`${base}/api/method/upload_file`, {
    method: "POST",
    headers,
    body: fd,
  });

  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = json?.exception || json?.message || text || `HTTP ${resp.status}`;
    throw new Error(`ERP upload_file failed: ${msg}`);
  }

  return json?.message || json;
}

function buildDetailsLines(title, obj) {
  const lines = [];
  if (title) lines.push(title);
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    lines.push(`${k}: ${s}`);
  }
  return lines.join("\n");
}

async function submitToErpNext(env, request, formKind, form) {
  const kind = String(formKind || "").trim();
  if (!kind) throw new Error("Missing form_kind");

  const get = (k) => (form instanceof Map ? form.get(k) : form.get(k));
  const userAgent = request.headers.get("User-Agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";

  const leadDoctype = String(env.ERPNEXT_LEAD_DOCTYPE || "Lead");
  const applicantDoctype = String(env.ERPNEXT_APPLICANT_DOCTYPE || "Job Applicant");

  if (kind === "employer_inquiry" || kind === "contract_inquiry" || kind === "fulltime_inquiry") {
    const companyName = String(get("companyName") || "").trim();
    const contactName = String(get("name") || get("contactName") || "").trim();
    const email = String(get("email") || "").trim();

    const lead = await erpCreateResource(env, leadDoctype, {
      lead_name: contactName || companyName || "Website Inquiry",
      company_name: companyName || undefined,
      email_id: email || undefined,
    });

    const details = buildDetailsLines("Website submission (JRecruits)", {
      kind,
      companyName,
      contactName,
      email,
      position: get("position") || get("yourPosition") || "",
      rolesHiringFor: get("rolesHiringFor") || get("roles") || get("positionHiringFor") || "",
      salaryRange: get("salaryRange") || get("rateRange") || "",
      engagementType: get("engagementType") || "",
      weeklyHours: get("weeklyHours") || "",
      duration: get("duration") || "",
      location: get("location") || get("workLocation") || "",
      roleType: get("roleType") || "",
      message: get("message") || get("message-textarea") || get("roleDescription") || "",
      ip,
      userAgent,
    });

    await erpCreateResource(env, "Comment", {
      comment_type: "Comment",
      reference_doctype: leadDoctype,
      reference_name: lead.name,
      content: details,
    });

    return;
  }

  if (kind === "candidate_application" || kind === "job_application") {
    const name = String(get("name") || "").trim();
    const email = String(get("email") || "").trim();
    const phone = String(get("phone") || "").trim();

    const applicant = await erpCreateResource(env, applicantDoctype, {
      applicant_name: name || "Website Applicant",
      email_id: email || undefined,
      phone_number: phone || undefined,
    });

    const details = buildDetailsLines("Website submission (JRecruits)", {
      kind,
      name,
      email,
      phone,
      roleOfInterest: get("roleOfInterest") || "",
      jobTitle: get("job_title") || "",
      resumeUrl: get("resumeUrl") || "",
      coverLetter: get("coverLetter") || "",
      ip,
      userAgent,
    });

    await erpCreateResource(env, "Comment", {
      comment_type: "Comment",
      reference_doctype: applicantDoctype,
      reference_name: applicant.name,
      content: details,
    });

    const resume = get("resume");
    if (resume && typeof resume === "object" && "arrayBuffer" in resume) {
      const file = resume;
      const maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new Error("Resume file too large");
      }
      const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (file.type && !allowed.includes(file.type)) {
        throw new Error("Unsupported resume file type");
      }

      await erpUploadFile(env, {
        file,
        doctype: applicantDoctype,
        docname: applicant.name,
        isPrivate: true,
      });
    }

    return;
  }

  throw new Error(`Unsupported form_kind: ${kind}`);
}
