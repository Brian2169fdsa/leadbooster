# Pre-Call Brief System Test Report
**Date:** 2026-03-18 (Run 2 — refreshed)
**Workflow:** WF-PRECALL-BRIEFING (NthQ2FsFZ726kVV4)
**Status:** Active

---

## PRECALL BRIEF SYSTEM STATUS: PARTIALLY WORKING

The system generates complete briefs with all required sections for every company type, but multiple enrichment APIs are failing silently, resulting in degraded data quality across all tests.

---

## STEP 1 — NODE CHAIN

```
Webhook
  ├─> Respond Immediately (returns {status:"processing"} to caller)
  └─> Get Existing Contacts                   [alwaysOutputData: true]  ✅
        └─> Apollo Company Enrich              [alwaysOutputData: true]  ✅
              └─> Google News Search           [alwaysOutputData: true]  ✅
                    └─> BuiltWith Tech Stack   [alwaysOutputData: true]  ✅
                          └─> Pipedrive Company Search [alwaysOutputData: true]  ✅
                                └─> Job Postings Search [alwaysOutputData: true]  ✅
                                      └─> Website Scrape Fallback [alwaysOutputData: true]  ✅
                                            └─> Website Google Search [alwaysOutputData: true]  ✅
                                                  └─> Generate Brief [alwaysOutputData: NOT SET]  ⚠️
```

**Total nodes:** 11
**SILENT FAILURE NODES (missing alwaysOutputData: true):** Generate Brief only (terminal node — acceptable but risky).

---

## STEP 2 — GENERATE BRIEF CODE ANALYSIS

| # | Check | Result | Detail |
|---|-------|--------|--------|
| 1 | lb-pd-activity webhook call | **YES** | POST to `/webhook/lb-pd-activity` |
| 1a | Before return statement? | **YES** | Fires before `return [{json: ...}]` |
| 2 | Reads Website Scrape Fallback | **YES** | `$('Website Scrape Fallback').first().json` |
| 3 | Website Google Search read | **YES** | `$('Website Google Search').first().json` |
| 4 | dataConfidence logic | **YES** | high if Apollo, medium if website/search, low otherwise |
| 5 | Fallback brief if Claude fails | **YES** | Full template with all 7 required sections |
| 6 | Dual API key retry | **YES** | 2 `sk-ant-api03` keys, loop breaks on success |
| 7 | Always writes to lb_precall_briefs | **YES** | Supabase POST always fires |

### BUG: Missing columns in Supabase write

The Supabase POST body does NOT include `data_confidence` or `website_scraped`. These columns exist in the table but are always NULL.

### EXPRESSION CONTEXT BUG (ROOT CAUSE OF APOLLO FAILURE)

**4 nodes use `$json` to reference webhook data:**
- `Get Existing Contacts` — `($json.body || $json).domain` — **WORKS** (receives webhook data directly)
- `Apollo Company Enrich` — `($json.body || $json).domain` — **BROKEN** (receives contact records from Get Existing Contacts, which have `first_name`, `last_name` etc. — no `domain` field)
- `Google News Search` — `($json.body || $json).company_name` — **BROKEN** (same problem)
- `BuiltWith Tech Stack` — `($json.body || $json).domain` — **BROKEN** (same problem)

**5 nodes correctly use `$('Webhook').first().json`:**
- `Pipedrive Company Search` — **CORRECT**
- `Job Postings Search` — **CORRECT**
- `Website Scrape Fallback` — **CORRECT**
- `Website Google Search` — **CORRECT**
- (Generate Brief uses `$('Webhook').first().json` inside its code block)

**This is the #1 systemic bug.** Nodes 2-4 in the chain send empty strings to their APIs because `$json` points to the previous node's output, not the original webhook payload.

---

## STEP 3 & 4 — TEST RESULTS (Run 2)

All 5 webhooks returned `{"status":"processing"}` immediately. All 5 executions completed successfully.

| Test | Company | Confidence (computed) | Brief Length | Sections 7/7 | Contacts | Result |
|------|---------|----------------------|-------------|---------------|----------|--------|
| A | DPR Construction | medium | 4,406 chars | YES | 10 | **PASS** |
| B | Pacific Lifestyle Homes | medium | 3,835 chars | YES | 1 | **PASS** |
| C | Adelante Healthcare | medium | 4,143 chars | YES | 10 | **PASS** |
| D | Southwest Ambulance | medium | 4,152 chars | YES | 1 | **PASS** |
| E | Desert Valley Contractors | medium | 4,068 chars | YES | 1 | **PASS** |

### Section Presence (all 5 tests):
- WARM OPENER: YES (5/5)
- COMPANY SNAPSHOT: YES (5/5)
- TECH STACK INTELLIGENCE: YES (5/5)
- WHO YOU ARE MEETING: YES (5/5)
- DISCOVERY QUESTIONS: YES (5/5)
- OBJECTION PREP: YES (5/5)
- RECOMMENDED NEXT STEP: YES (5/5)

**PASS RATE: 5/5** (all briefs generated with all sections)

**However:** `data_confidence` and `website_scraped` are NULL in Supabase for all 5 (missing from POST body).

---

## STEP 5 — EXECUTION LOGS

| Execution ID | Status | Duration | Company |
|-------------|--------|----------|---------|
| 28505 | success | 38.7s | DPR Construction |
| 28504 | success | 24.5s | Pacific Lifestyle Homes |
| 28503 | success | 44.3s | Adelante Healthcare |
| 28502 | success | 47.6s | Southwest Ambulance |
| 28500 | success | 25.7s | Desert Valley Contractors |

No node failures (all marked `success`). All Generate Brief nodes completed.

### Node-Level Analysis (Execution 28505 — DPR Construction)

| Node | Status | Detail |
|------|--------|--------|
| Get Existing Contacts | **SUCCESS** | 10 contacts with ICP scores |
| Apollo Company Enrich | **NO_DATA** | Returns empty `{}` — sends `domain: ""` due to `$json` context bug |
| Google News Search | **ERROR** | `403: This project does not have the access to Custom Search JSON API` |
| BuiltWith Tech Stack | **SUCCESS** | Returns `{"Results":[],"Errors":[]}` — sends empty domain due to same `$json` bug |
| Pipedrive Company Search | **SUCCESS** | Correctly uses `$('Webhook')` — returns real data |
| Job Postings Search | **ERROR** | `403: Custom Search JSON API access denied` |
| Website Scrape Fallback | **SUCCESS** | Jina returned 15,763 chars for dpr.com |
| Website Google Search | **ERROR** | `403: Custom Search JSON API access denied` |
| Generate Brief | **SUCCESS** | 4,406 chars, confidence=medium, apollo=false, scraped=true |

### Cross-Execution Comparison

| Node | 28505 (DPR) | 28504 (Pacific) | 28503 (Adelante) | 28502 (SW Amb) | 28500 (Desert) |
|------|------------|----------------|-----------------|---------------|---------------|
| Apollo | EMPTY | EMPTY | EMPTY | EMPTY | EMPTY |
| BuiltWith | OK (empty results) | OK | 429 rate limit | OK | OK |
| Pipedrive | OK | OK | 429 rate limit | OK | OK |
| Website Scrape | OK | OK | OK | OK | OK |
| Google Search (3 nodes) | 403 | 403 | 403 | 403 | 403 |

**Apollo fails 5/5** (expression bug). **Google Search fails 5/5** (API not enabled). **BuiltWith/Pipedrive intermittently 429** under concurrent load.

---

## STEP 6 — FRONTEND POLLING (from local codebase index.html:5180)

```javascript
async function pollPreCallBrief(domain, company) {
    let attempts = 0;
    const maxAttempts = 40; // 160 seconds
    preCallPollInterval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) { clearInterval(...); return; }
        const since = new Date(Date.now() - 600000).toISOString();
        const rows = await sbProxy('lb_precall_briefs', 'GET',
            'domain=eq.' + domain + '&order=created_at.desc&limit=1&created_at=gte.' + since);
        if (rows && rows[0] && rows[0].brief_text) { ... }
    }, 4000);
}
```

| Setting | Value |
|---------|-------|
| maxAttempts | **40** |
| Polling interval | **4,000ms** (4 seconds) |
| Since window | **600,000ms** (10 minutes) |
| Total polling duration | **160 seconds** |
| Queries lb_precall_briefs? | **YES** |
| Filters by domain? | **YES** — `domain=eq.{domain}` |
| Filters by created_at? | **YES** — `created_at=gte.{since}` |
| Checks brief_text populated? | **YES** — `rows[0].brief_text` |

Note: The live Vercel deployment does NOT expose the polling code in the initial HTML — it's likely bundled separately or the deployed version differs from the local codebase. The analysis above is from the local `index.html`.

---

## FINAL REPORT

### PRECALL BRIEF SYSTEM STATUS: PARTIALLY WORKING

### NODE CHAIN:
```
Webhook [aOD: —] → Respond Immediately [aOD: —]
                  → Get Existing Contacts [aOD: true ✅]
                    → Apollo Company Enrich [aOD: true ✅]
                      → Google News Search [aOD: true ✅]
                        → BuiltWith Tech Stack [aOD: true ✅]
                          → Pipedrive Company Search [aOD: true ✅]
                            → Job Postings Search [aOD: true ✅]
                              → Website Scrape Fallback [aOD: true ✅]
                                → Website Google Search [aOD: true ✅]
                                  → Generate Brief [aOD: NOT SET ⚠️]
```

### SILENT FAILURE NODES:
- **Generate Brief** — missing `alwaysOutputData: true` (terminal node, low risk but should be set)

### TEST RESULTS:
| Test | Company | Result | Confidence | Length |
|------|---------|--------|-----------|--------|
| A | DPR Construction | **PASS** | medium | 4,406 chars |
| B | Pacific Lifestyle Homes | **PASS** | medium | 3,835 chars |
| C | Adelante Healthcare | **PASS** | medium | 4,143 chars |
| D | Southwest Ambulance | **PASS** | medium | 4,152 chars |
| E | Desert Valley Contractors | **PASS** | medium | 4,068 chars |

### PASS RATE: 5/5

### ROOT CAUSES OF FAILURES:
1. **Apollo Company Enrich** — `$json` expression resolves to Get Existing Contacts output (contact records), not webhook data. Sends `domain: ""` to Apollo API. Returns empty `{}`.
2. **Google News Search** — Same `$json` bug (sends empty company_name) AND Google Custom Search API is not enabled (403).
3. **BuiltWith Tech Stack** — Same `$json` bug (sends empty domain) AND rate limited under concurrent load (429).
4. **Google Custom Search API** — Not enabled on GCP project. Blocks 3 nodes: Google News, Website Google Search, Job Postings.
5. **Supabase write** — Missing `data_confidence` and `website_scraped` in POST body.

### APOLLO STATUS:
- Returning data in n8n: **NO** (empty object — sends empty domain)
- API key correct: **YES** (works via direct curl — returns DPR Construction, 8,900 employees)
- Root cause: `$json` expression context bug — should use `$('Webhook').first().json.body.domain`

### JINA SCRAPE (Website Scrape Fallback):
- Firing and returning content: **YES**
- Content length avg: ~10,232 chars (range: 437 for redirected sites to 21,397 for well-built sites)
- This is currently the PRIMARY working data source keeping briefs useful

### FALLBACK BRIEF:
- Triggers when needed: **YES** (code-verified — activates if Claude returns < 100 chars)
- Returns useful content: **YES** (full template with all 7 sections)
- Did not trigger in tests (Claude API succeeded for all 5)

### PIPEDRIVE ACTIVITY LOG (lb-pd-activity):
- Firing after brief: **YES** (confirmed in code — fires before return statement)

### FRONTEND POLLING:
- maxAttempts: **40**
- interval: **4,000ms**
- since window: **600,000ms**
- reads lb_precall_briefs: **YES**
- filters by domain and created_at: **YES**
- Correctly reads briefs: **YES**

---

## RELEASE READY: NO

### Fixes needed (in priority order):

1. **FIX `$json` expression bug in 3 nodes** — Apollo Company Enrich, Google News Search, and BuiltWith Tech Stack all use `($json.body || $json)` which resolves to the previous node's output, not the webhook payload. Change to `$('Webhook').first().json.body` (matching the pattern used by Pipedrive, Job Postings, Website Scrape, and Website Google Search nodes which already work correctly).

2. **Enable Google Custom Search JSON API** on GCP project (API key: `AIzaSyA3blo1W2pKT9oQD9f6SfPqfNcroeU6mZs`). This unblocks 3 nodes: Google News Search, Website Google Search, Job Postings Search.

3. **Add `data_confidence` and `website_scraped` to Supabase POST body** in Generate Brief code. Currently computed but never saved — always NULL in database.

4. **Add rate limiting / batching** for BuiltWith and Pipedrive nodes to prevent 429 errors under concurrent load.

5. **Set `alwaysOutputData: true`** on Generate Brief node for safety.

**After fixes #1 and #2:** DPR Construction would become "high" confidence (Apollo + website + news), and all companies would have richer briefs with real tech stack, news, and job posting data.
