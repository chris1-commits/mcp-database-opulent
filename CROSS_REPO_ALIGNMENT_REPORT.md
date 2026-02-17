# Cross-Repository Alignment Report: Opulent Horizons MCP Ecosystem

**Generated:** 2026-02-17
**Scope:** All 6 Opulent Horizons repositories

---

## 1. Repository Roles & Relationships

| # | Repository | Language | Role | Status |
|---|-----------|----------|------|--------|
| 1 | **MCP-Gateway-OpulentHorizons** | TypeScript | Full-featured MCP server (32+ tools), stdio + HTTP | Production-ready, most complete |
| 2 | **TypeScript** | TypeScript | Near-clone of #1, intended as the "canonical" TS build | Incomplete fork — missing critical files |
| 3 | **MCP-Gateway-Claude-Desktop** | Python | Official MCP SDK implementation (lead ingest + Zoho sync) | Production-ready, modern pattern |
| 4 | **mcp-database-opulent** | Python | FastAPI-based MCP gateway with webhooks | Legacy/deprecated pattern (hand-rolled JSON-RPC) |
| 5 | **mcp-whatsapp-webhook-test** | Node.js | WhatsApp webhook processor | Incomplete — missing dependencies & referenced files |
| 6 | **opulenthorizons-mcp** | N/A | Documentation hub (GitHub Pages) | Stub — only README + Jekyll workflow |

---

## 2. CRITICAL MISALIGNMENTS

### CRITICAL 1: TypeScript repo is a degraded copy of MCP-Gateway-OpulentHorizons

The `TypeScript` repo appears to be an attempted "clean" copy of `MCP-Gateway-OpulentHorizons` but has **gutted all the production-hardened utilities** while keeping the same `index.ts` that imports them:

| File | MCP-Gateway-OpulentHorizons | TypeScript | Impact |
|------|---------------------------|-----------|--------|
| `src/utils/env.ts` | Full Zoho config parsing, Postgres fallback, SSL, rate limit config | **STUB** — `parseZohoEnv()` returns `{}`, no SSL, no PG* fallback | Zoho CRM gateway tools will fail at runtime |
| `src/utils/validate.ts` | AJV Draft 2020-12 validation with schema loading + caching | **NO-OP** — always returns `{ valid: true }` | All input validation bypassed — unsafe for production |
| `src/utils/trace.ts` | Typed generics, `Envelope<T>`, typed error codes, `endTrace()` | Different field names (`id` vs `traceId`), no generics, flat `rate_limit_per_min` | Envelope shape mismatch — consumers expecting Repo A's format will break |
| `src/utils/rateLimit.ts` | Token bucket with discrete refill, cached config, exponential backoff, `onStatus` callback | Continuous refill, re-parses JSON every call, linear backoff, no callback | Different runtime behavior; config re-parsing is wasteful |
| `src/clients/zoho.ts` | Uses `parseZohoEnv()`, 10s/30s timeouts, 401 auto-retry | Reads env directly, **no timeouts**, **no 401 retry** | API calls can hang forever; expired tokens cause hard failures |
| `src/schemas/zoho/` | 6 JSON Schema files (Draft 2020-12) | **MISSING ENTIRELY** | `validate.ts` would fail even if it weren't a stub |
| `src/types/zoho.ts` | `CrmModule`, `SearchInput`, `UpsertInput`, `ActivityInput` types | **MISSING ENTIRELY** | No type safety for Zoho operations |
| `src/types/ajv-2020.d.ts` | Type declaration for AJV import | **MISSING** | TypeScript compilation would fail if `validate.ts` were real |
| `src/http-gateway.ts` | HTTP health + MCP endpoint server | **MISSING** | No Docker/HTTP deployment possible |
| `tests/` | 3 test files | **MISSING ENTIRELY** | No test coverage |
| `docs/` | 12 documentation files | **MISSING ENTIRELY** | No deployment/security docs |
| `.vscode/` | 6 config files (launch, mcp, tasks) | **MISSING ENTIRELY** | No IDE configuration |
| `secrets/required-secrets.json` | 40+ env var manifest | **MISSING** | No secrets audit trail |
| `scripts/` | 35 scripts (PS1 + JS) | 6 scripts (JS only) | Missing 29 operational scripts |

### CRITICAL 2: `chatgpt.connector` tool missing from TypeScript repo

The `chatgpt.connector` tool (Azure OpenAI with public OpenAI fallback) is registered in MCP-Gateway-OpulentHorizons but **completely absent** from the TypeScript repo. This is the only tool-level difference between the two `index.ts` files.

### CRITICAL 3: Dual Zoho OAuth token caches (affects both TS repos)

Both TypeScript repos have **two independent OAuth token caches** at runtime:
- **Cache A**: In `index.ts` via `_zohoAccessToken`/`_zohoTokenExpiry` (used by `zoho.crm` and `zoho.desk` tools)
- **Cache B**: In `clients/zoho.ts` via its own variables (used by `zoho.crm.search`, upsert tools, etc.)

This means token refreshes in one cache don't propagate to the other, causing unnecessary API calls and potential race conditions.

### CRITICAL 4: MCP SDK version mismatch

| Repo | `@modelcontextprotocol/sdk` version |
|------|-------------------------------------|
| MCP-Gateway-OpulentHorizons | `^1.2.0` |
| TypeScript | `^1.26.0` |
| MCP-Gateway-Claude-Desktop (Python) | `mcp>=1.26.0` |

The OpulentHorizons TS repo uses a much older SDK version. The TypeScript repo and Python repo are aligned at 1.26.0+.

### CRITICAL 5: Build system divergence

| Repo | Build | Strict Mode | Module System |
|------|-------|-------------|---------------|
| MCP-Gateway-OpulentHorizons | `tsc` | `strict: true` | Node16 |
| TypeScript | `esbuild` (bundler) | `strict: false` | ES2022 |

`strict: false` in the TypeScript repo hides type errors that would surface the stub/missing-file problems.

### CRITICAL 6: mcp-whatsapp-webhook-test is incomplete

Missing from the repository but referenced in code:
- `package.json` (no dependency declarations)
- `./verify.js` (imported by `index.js`)
- `./hmac.js` (imported by `index.js`)
- `./src/validate.js` (referenced in README)
- `Dockerfile` and `docker-compose.yml` (mentioned in README)
- Database schema/migration for `whatsapp_events` table

### CRITICAL 7: opulenthorizons-mcp is an empty stub

Only contains a 2-line README and a Jekyll GitHub Pages workflow.

---

## 3. PYTHON REPO MISALIGNMENTS

### MCP-Gateway-Claude-Desktop vs mcp-database-opulent

| Aspect | MCP-Gateway-Claude-Desktop | mcp-database-opulent |
|--------|---------------------------|---------------------|
| **MCP Protocol** | Official `mcp` SDK (`@mcp.tool()` decorator) | Hand-rolled JSON-RPC 2.0 |
| **Framework** | MCP SDK + FastAPI (webhooks only) | FastAPI for everything |
| **DB Driver** | `asyncpg` (direct) | `sqlalchemy[asyncio]` + `asyncpg` |
| **Zoho Auth** | `ZohoTokenManager` (async lock, auto-refresh) | Not implemented |
| **Domain Models** | Shared `models.py` (proper module) | Inline in `main.py` |
| **Repository Pattern** | Abstract + Postgres + InMemory | Abstract + Postgres (inline) |
| **Schema** | Separate `schema.sql` with GIN indexes | Inline SQL, no schema file |
| **Tests** | 4 test files (pytest) | Embedded async tests in main.py |
| **CI/CD** | GitHub Actions + Azure Container Registry + Bicep | GitHub Actions + GHCR + Terraform |
| **Python Version** | `>=3.11` | `>=3.9` |

`MCP-Gateway-Claude-Desktop` is the clear **successor** to `mcp-database-opulent`.

### Zoho API Version Mismatch

| Repo | Zoho API Version |
|------|-----------------|
| TypeScript repos | `/crm/v3` |
| Python repo (Claude-Desktop) | `/crm/v2` |

### Environment Variable Naming Inconsistencies

| Variable | TS repos | Claude-Desktop | database-opulent | whatsapp-webhook |
|----------|---------|----------------|------------------|-----------------|
| Zoho API Base | `ZOHO_CRM_BASE` / `ZOHO_DC` | `ZOHO_API_BASE` | N/A | N/A |
| Zoho Token URL | Derived from `ZOHO_ACCOUNTS_BASE` | `ZOHO_TOKEN_URL` | N/A | N/A |
| WhatsApp Secret | N/A | N/A | `WHATSAPP_APP_SECRET` | `APP_SECRET` |
| ElevenLabs Auth | `ELEVENLABS_API_KEY` | `ELEVENLABS_WEBHOOK_SECRET` | `ELEVENLABS_API_KEY` | N/A |
| Postgres | `POSTGRES_*` (primary) + `PG*` (fallback) | `PG*` only | `PG*` only | `DATABASE_URL` |

---

## 4. FEATURE COVERAGE MATRIX

| Feature | OpulentHorizons (TS) | TypeScript | Claude-Desktop (Py) | database-opulent (Py) | whatsapp-webhook |
|---------|:---:|:---:|:---:|:---:|:---:|
| Zoho CRM CRUD | Full | Full (broken utils) | Sync only | None | None |
| Zoho CRM Search | Yes | Yes (no validation) | No | No | No |
| Zoho CRM Upsert | Yes | Yes (no validation) | Yes | No | No |
| Zoho OAuth2 | Yes (with retry) | Yes (no retry) | Yes (async lock) | No | No |
| Lead Ingestion | No | No | Yes (full pipeline) | Yes (in-memory) | Via n8n hook |
| OHID Resolution | No | No | Yes | Yes | No |
| Twilio Webhooks | No | No | Yes | Yes | No |
| WhatsApp Webhooks | No | No | No | Yes (handler) | Yes (full) |
| Notion Webhooks | No | No | Yes | Yes | No |
| ElevenLabs Webhooks | No | No | Yes (pre/post call) | No | No |
| ElevenLabs TTS | Yes | Yes | No | No | No |
| GitHub Tools | Yes (4 tools) | Yes (4 tools) | No | No | No |
| OpenAI/Azure Chat | Yes | Yes | No | No | No |
| n8n Proxy | Yes | Yes | No | Yes | Via hook |
| Foundry Proxy | Yes | Yes | No | No | No |
| Google Sheets | Yes (stub) | Yes (stub) | No | No | No |
| Meta Lead Ads | Yes | Yes | No | No | No |
| Postgres Query | Yes | Yes | Yes (repository) | Yes (SQLAlchemy) | Yes (raw) |
| Rate Limiting | Yes (token bucket) | Yes (different algo) | No | No | No |
| Schema Validation | Yes (AJV 2020-12) | No (stub) | Yes (Pydantic) | Yes (Pydantic) | Partial |
| Request Tracing | Yes (correlation ID) | Yes (different shape) | Yes (correlation ID) | No | No |
| Docker | Yes | No | Yes | Yes | Missing |
| Azure Deployment | Yes (Functions + Bicep) | No | Yes (Container Apps) | Yes (ACI + ECS) | No |
| CI/CD | No workflow file | No | Yes (GitHub Actions) | Yes (GitHub Actions) | No |
| Tests | 3 files | None | 4 files | Embedded | None |
| Documentation | 12 docs | None | 4 docs | 4 docs | 1 README |

---

## 5. RECOMMENDATIONS FOR CANONICAL REPOSITORY

### Immediate Actions (P0)

1. Copy all missing files from OpulentHorizons to TypeScript repo (schemas, types, http-gateway, tests, docs, .vscode, secrets)
2. Replace stub `utils/env.ts` with OpulentHorizons' production version
3. Replace stub `utils/validate.ts` with OpulentHorizons' AJV version
4. Replace `utils/trace.ts` with OpulentHorizons' typed version
5. Replace `utils/rateLimit.ts` with OpulentHorizons' version
6. Replace `clients/zoho.ts` with OpulentHorizons' version (has timeouts + 401 retry)
7. Add missing `chatgpt.connector` tool to TypeScript repo
8. Set `strict: true` in TypeScript repo's tsconfig.json

### High Priority (P1)

9. Upgrade MCP SDK to `^1.26.0` in MCP-Gateway-OpulentHorizons
10. Unify Zoho API version (v2 vs v3) across TS and Python repos
11. Eliminate dual OAuth token cache in index.ts (refactor to use clients/zoho.ts exclusively)
12. Add missing files to mcp-whatsapp-webhook-test (package.json, verify.js, hmac.js, validate.js, Dockerfile)
13. Integrate WhatsApp webhook handler into MCP-Gateway-Claude-Desktop

### Medium Priority (P2)

14. Standardize env var naming across all repos
15. Standardize PostgreSQL config approach
16. Add CI/CD workflows to TypeScript repos
17. Populate opulenthorizons-mcp with actual documentation

### Repos That Can Be Retired

- **mcp-database-opulent**: Fully superseded by MCP-Gateway-Claude-Desktop
- **opulenthorizons-mcp**: Either populate with real docs or remove
- **TypeScript**: Should be merged with MCP-Gateway-OpulentHorizons (maintaining two near-identical TS repos is unsustainable)

### Recommended Final Canonical Structure

```
opulenthorizons-mcp/                    # Monorepo
├── packages/
│   ├── mcp-gateway-ts/                 # From MCP-Gateway-OpulentHorizons (32+ tools)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── http-gateway.ts
│   │   │   ├── clients/zoho.ts
│   │   │   ├── utils/{env,validate,trace,rateLimit}.ts
│   │   │   ├── types/zoho.ts
│   │   │   └── schemas/zoho/*.json
│   │   ├── tests/
│   │   ├── package.json (@modelcontextprotocol/sdk ^1.26.0)
│   │   └── tsconfig.json (strict: true)
│   │
│   ├── mcp-lead-ingest/                # From MCP-Gateway-Claude-Desktop
│   │   ├── servers/lead_ingest.py
│   │   ├── shared/{models,repository,auth,middleware,zoho_auth,schema}.py
│   │   └── src/elevenlabs_webhooks.py
│   │
│   ├── mcp-zoho-sync/                  # From MCP-Gateway-Claude-Desktop
│   │   └── servers/zoho_crm_sync.py
│   │
│   └── whatsapp-webhook/               # From mcp-whatsapp-webhook-test (completed)
│       ├── index.js
│       ├── messages.js
│       ├── statuses.js
│       ├── verify.js
│       ├── hmac.js
│       └── package.json
│
├── infra/                              # Unified IaC
│   ├── main.bicep                      # Azure Container Apps
│   └── terraform/                      # AWS ECS alternative
│
├── docs/                               # Consolidated documentation
├── .github/workflows/                  # Unified CI/CD
└── docker-compose.yml                  # Full local dev stack
```
