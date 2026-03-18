# Pre-Call Brief System Test Report
**Date:** 2026-03-18
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
  └─> Get Existing Contacts
        └─> Apollo Company Enrich
              └─> Google News Search
                    └─> BuiltWith Tech Stack
                          └─> Pipedrive Company Search
                                └─> Job Postings Search
                                      └─> Website Scrape Fallback
                                            └─> Website Google Search
                                                  └─> Generate Brief
```

### alwaysOutputData Status

| Node | alwaysOutputData | Status |
|------|-----------------|--------|
| Webhook | NOT SET | OK (always has data) |
| Respond Immediately | NOT SET | OK (response node) |
| Get Existing Contacts | **true** | OK |
| Apollo Company Enrich | **true** | OK |
| Google News Search | **true** | OK |
| BuiltWith Tech Stack | **true** | OK |
| Pipedrive Company Search | **true** | OK |
| Job Postings Search | **true** | OK |
| Website Scrape Fallback | **true** | OK |
| Website Google Search | **true** | OK |
| Generate Brief | **NOT SET** | RISK — terminal node so acceptable, but would lose error info |

**SILENT FAILURE NODES (missing alwaysOutputData: true):** Generate Brief only. All HTTP enrichment nodes correctly have `alwaysOutputData: true` set at the node level, so the chain never breaks even when APIs fail.

---

## STEP 2 — GENERATE BRIEF CODE ANALYSIS

| Check | Result | Notes |
|-------|--------|-------|
| 1. lb-pd-activity webhook call | **YES** | Line 362: POST to `/webhook/lb-pd-activity` |
| 1a. Before return statement? | **YES** | Fires at line 362, return at line 385 |
| 2. Jina scrape read (Website Scrape Fallback) | **YES** | Line 63: `$('Website Scrape Fallback').first().json` |
| 3. Website Google Search read | **YES** | Line 73: `$('Website Google Search').first().json` |
| 4. dataConfidence logic | **YES** | Lines 80-90: high/medium/low based on Apollo, website, web search |
| 5. Fallback brief if Claude fails | **YES** | Lines 268-311: Full hardcoded brief template |
| 6. Dual API key retry | **YES** | Lines 232-265: Two API keys with loop, breaks on success |
| 7. Always writes to lb_precall_briefs | **YES** | Lines 313-341: Supabase POST always fires |

### BUG FOUND — Missing columns in Supabase write

The Supabase POST body (lines 325-336) does NOT include:
- `data_confidence` — computed but never saved
- `website_scraped` — computed but never saved

These columns exist in the `lb_precall_briefs` table but are always NULL. The Generate Brief node computes them correctly (returned in the output JSON at line 390-393) but the Supabase save payload omits them.

---

## STEP 3 & 4 — TEST RESULTS

All 5 webhooks returned `{"status":"processing"}` immediately. All 5 executions completed successfully.

| Test | Company | Confidence (computed) | Brief Length | Sections Complete | Contacts | Result |
|------|---------|----------------------|-------------|-------------------|----------|--------|
| A | DPR Construction | medium | 4,143 chars | 7/7 | 10 | **PASS** |
| B | Pacific Lifestyle Homes | medium | 4,118 chars | 7/7 | 1 | **PASS** |
| C | Adelante Healthcare | medium | 4,087 chars | 7/7 | 10 | **PASS** |
| D | Southwest Ambulance | medium | 3,916 chars | 7/7 | 1 | **PASS** |
| E | Desert Valley Contractors | low | 3,522 chars | 7/7 | 1 | **PASS** |

### Section Presence (all 5 tests):
- WARM OPENER: YES (5/5)
- COMPANY SNAPSHOT: YES (5/5)
- TECH STACK: YES (5/5)
- WHO YOU ARE MEETING: YES (5/5)
- DISCOVERY QUESTIONS: YES (5/5)
- OBJECTION PREP: YES (5/5)
- RECOMMENDED NEXT STEP: YES (5/5)

**PASS RATE: 5/5** (all briefs generated with all sections)

**However:** All results have `data_confidence: NULL` and `website_scraped: NULL` in Supabase due to the missing fields bug above.

---

## STEP 5 — EXECUTION LOGS

| Execution ID | Status | Duration | Company |
|-------------|--------|----------|---------|
| 27555 | success | 25.7s | DPR Construction |
| 27554 | success | 34.8s | Adelante Healthcare |
| 27553 | success | 26.1s | Southwest Ambulance |
| 27552 | success | 45.5s | Desert Valley Contractors |
| 27551 | success | 26.6s | Pacific Lifestyle Homes |

No node failures. All Generate Brief nodes completed. Desert Valley took longest (45.5s) as the unknown company with least data.

---

## STEP 6 — SILENT FAILURE NODE ANALYSIS (Execution 27555 — DPR Construction)

| Node | Status | Detail |
|------|--------|--------|
| Get Existing Contacts | **SUCCESS** | Returned 10 contacts with ICP scores |
| Apollo Company Enrich | **ERROR (silent)** | Returned empty object `{}` — API key works externally but n8n node returns empty |
| Google News Search | **ERROR (silent)** | `403: This project does not have access to Custom Search JSON API` |
| BuiltWith Tech Stack | **ERROR (silent)** | `429: Rate limited` — "Try spacing your requests out" |
| Pipedrive Company Search | **ERROR (silent)** | `429: Rate limited` — same as BuiltWith |
| Job Postings Search | **ERROR (silent)** | `403: Custom Search JSON API access denied` |
| Website Scrape Fallback | **SUCCESS** | Jina returned 15,763 chars of content for dpr.com |
| Website Google Search | **ERROR (silent)** | `403: Custom Search JSON API access denied` |
| Generate Brief | **SUCCESS** | Produced 4,143 char brief |

### Root Cause Summary:
- **Apollo**: API key `q54-425S9MpJYWrWR3NK6A` works when called directly via curl (returns DPR Construction with 8,900 employees), but returns empty `{}` from n8n. Likely an n8n HTTP Request node configuration issue — possibly the response is being parsed differently or the POST body expression isn't evaluating correctly.
- **Google Custom Search (3 nodes)**: Google Custom Search JSON API is not enabled on the GCP project. All 3 nodes using it (Google News, Website Google Search, Job Postings) fail with 403.
- **BuiltWith + Pipedrive**: Rate limited (429). Likely hitting free-tier limits when 5 tests fire simultaneously.

---

## STEP 7 — FRONTEND POLLING

| Setting | Value |
|---------|-------|
| maxAttempts | **40** |
| Polling interval | **4,000ms** (4 seconds) |
| Since window | **600,000ms** (10 minutes) |
| Total polling duration | **160 seconds** |
| Queries lb_precall_briefs? | **YES** — via `sbProxy('lb_precall_briefs', 'GET', ...)` |
| Filters by company correctly? | **YES** — filters by `domain=eq.{domain}` and `created_at=gte.{since}` |

The frontend polling is well-configured. 160-second window is generous enough for the ~25-45s workflow execution.

---

## FINAL REPORT

### PRECALL BRIEF SYSTEM STATUS: PARTIALLY WORKING

**The system produces complete, well-structured briefs for all company types**, but is operating in degraded mode because 5 of 8 enrichment APIs are failing silently.

### PASS RATE: 5/5
| Test | Result | Confidence | Length |
|------|--------|-----------|--------|
| Test A — DPR Construction | **PASS** | medium | 4,143 chars |
| Test B — Pacific Lifestyle Homes | **PASS** | medium | 4,118 chars |
| Test C — Adelante Healthcare | **PASS** | medium | 4,087 chars |
| Test D — Southwest Ambulance | **PASS** | medium | 3,916 chars |
| Test E — Desert Valley Contractors | **PASS** | low | 3,522 chars |

### ROOT CAUSES OF DEGRADED QUALITY

1. **Apollo Company Enrich** — Returns empty `{}` from n8n despite API key working externally. The node's `jsonBody` expression `={{ JSON.stringify({ domain: ($json.body || $json).domain || "" }) }}` may not be resolving correctly in the execution context after the `Get Existing Contacts` node transforms the data. DPR Construction should be "high" confidence but gets "medium" because Apollo data is missing.

2. **Google Custom Search API (3 nodes)** — `403: This project does not have access to Custom Search JSON API`. The GCP project needs the Custom Search JSON API enabled. Affects: Google News Search, Website Google Search, Job Postings Search.

3. **BuiltWith Tech Stack** — `429 Rate Limited`. Free tier or concurrent requests exceeding limit.

4. **Pipedrive Company Search** — `429 Rate Limited`. Same issue.

5. **Supabase write missing fields** — `data_confidence` and `website_scraped` are computed correctly in the Generate Brief node but are NOT included in the Supabase POST body. They are always NULL in the database.

### APOLLO STATUS
- Returning data in n8n: **NO** (empty object)
- API key correct: **YES** (works via direct curl — returns full org data for DPR Construction)
- Root cause: n8n HTTP Request node expression context issue

### JINA SCRAPE (Website Scrape Fallback)
- Firing and returning content: **YES**
- Content length avg: ~10,313 chars (range: 0 for unknown domains to 21,397 for known ones)
- This is the PRIMARY data source keeping briefs useful

### FALLBACK BRIEF
- Triggers when needed: **YES** (would trigger if Claude API fails)
- Returns useful content: **YES** (tested via code review — full template with all sections)
- Note: Did not trigger in these tests because Claude API succeeded for all 5

### PIPEDRIVE ACTIVITY LOG
- lb-pd-activity firing after brief: **YES** (code confirmed at line 362, fires before return)

### FRONTEND POLLING
- maxAttempts: **40**
- Interval: **4,000ms**
- Window: **600,000ms** (10 minutes)
- Correctly reads briefs: **YES** (filters by domain and created_at)

---

## RELEASE READY: NO

### Fixes needed (in priority order):

1. **FIX Apollo Company Enrich node** — The `$json` context after `Get Existing Contacts` no longer contains the original webhook body. The expression `($json.body || $json).domain` likely resolves to empty string. Fix: reference the Webhook node directly: `$('Webhook').first().json.body.domain`. This is the #1 priority — Apollo data drives "high" confidence briefs.

2. **Enable Google Custom Search JSON API** in the GCP project. This blocks 3 nodes: Google News Search, Website Google Search, and Job Postings Search.

3. **Add `data_confidence` and `website_scraped` to the Supabase POST body** in the Generate Brief code (line 326). These fields are computed but never saved. The frontend could use `data_confidence` to display quality indicators.

4. **Add rate limiting / retry logic** for BuiltWith and Pipedrive nodes, or stagger the 5 parallel enrichment nodes to avoid 429s when multiple briefs fire simultaneously.

5. **Consider adding `alwaysOutputData: true`** to the Generate Brief node — while it's terminal, adding it ensures n8n records a successful execution even if an error occurs mid-generation.
