# Repository Viability Review

**Repository:** mcp-database-opulent (Opulent MCP Gateway)
**Date:** 2026-02-06
**Verdict:** NOT VIABLE in current state — application cannot start due to a critical import error. Fixable with moderate effort.

---

## 1. Overview

This repository implements a FastAPI-based MCP (Model Context Protocol) gateway that exposes JSON-RPC 2.0 endpoints with Bearer token authentication. It provides webhook validation for CloudTalk and Notion (HMAC-SHA256), lead ingestion, and N8N workflow triggering. Infrastructure-as-code is included for both Azure ACI and AWS ECS Fargate deployments.

**Tech stack:** Python 3.11 / FastAPI / Pydantic v2 / SQLAlchemy (async) / asyncpg / httpx
**Total source code:** ~400 lines across 5 Python files
**Commits:** 12 (Dec 15, 2025 – Jan 6, 2026)

---

## 2. Critical Issues (Blockers)

### 2.1 Application fails to start — broken imports in `mcp_server.py`

**Severity: CRITICAL — the app cannot run.**

`gateway/mcp_server.py:11-19` imports 7 symbols from `gateway/main.py` that no longer exist:

```python
from .main import (
    CloudtalkWebhookPayload,
    Consent,
    LeadIngestRequest,
    Person,
    _FakeRepo,
    env_health,
    resolve_ohid,
)
```

These were removed when `main.py` was rewritten from ~300 lines to 80 lines in commit `8c214da` ("feat: Simple MCP Gateway with RPC endpoint and 6 tools"), but `mcp_server.py` was not updated. This means:

- `import gateway.mcp_server` raises `ImportError`
- `import gateway.mcp_router` also fails (it imports `mcp_server`)
- The `mcp_router` is never registered on the app anyway (see issue 2.2)
- 4 of the 6 advertised MCP tools (`lead_ingest`, `cloudtalk_webhook_validator`, `health_env`, `n8n_workflow_trigger`) are dead code that cannot execute

**Verified:**
```
$ python -c "from gateway import mcp_server"
ImportError: cannot import name 'CloudtalkWebhookPayload' from 'gateway.main'
```

### 2.2 `mcp_router` is never registered with the FastAPI app

`gateway/mcp_router.py` defines an `APIRouter` with a POST handler at `/api/rpc` that delegates to `mcp_server.handle_request()`. However, `create_app()` in `main.py` never calls `app.include_router(router)`. The router is dead code. This means the more complete JSON-RPC handler in `mcp_server.py` (which supports `tools/call`) is unreachable even if the import error were fixed.

### 2.3 Hard-coded Bearer token

`gateway/main.py:24` contains a hard-coded authentication token:

```python
expected_token = "9a61434eeb286110e05d83e51f0693b6df2429d365092fdac5e61d2e33b98b4c"
```

This is a security vulnerability. The token is committed to version control in plaintext. Meanwhile, `mcp_server.py:30` correctly reads from `MCP_AUTH_TOKEN` env var, showing the intended design was environment-based auth. The hard-coded token in `main.py` contradicts this.

---

## 3. Serious Issues

### 3.1 No test suite

- `pytest --collect-only` returns 0 tests collected
- No `tests/` directory or test files exist
- The CI pipeline's "Run tests" step executes `python gateway/main.py`, which simply defines a function and exits — it tests nothing
- The AGENTS.md file states a goal of ">80% coverage" but there is 0% coverage
- `pytest-asyncio` is pinned to `0.21.0` in dependencies but was installed as `1.3.0`, suggesting the pin is outdated

### 3.2 Duplicate/conflicting endpoint implementations

There are two parallel implementations of `/api/rpc`:

| Component | Location | Auth method | Tool execution |
|-----------|----------|-------------|----------------|
| `main.py` inline handler | `main.py:42-78` | Hard-coded token | Only `ping` and `tools/list` (lists tools but can't call them) |
| `mcp_router.py` + `mcp_server.py` | `mcp_router.py:19-29` | `MCP_AUTH_TOKEN` env var | Full `tools/call` dispatch to all 6 tools |

The inline handler in `main.py` advertises 6 tools via `tools/list` but can only execute `health_ping`. Calling any other tool returns 404. The full implementation in `mcp_server.py` is unreachable.

### 3.3 Declared dependencies are unused

`pyproject.toml` declares these dependencies, but the current working code (`main.py`) uses none of them:

- `sqlalchemy[asyncio]>=2.0.0` — no database models or sessions exist
- `asyncpg>=0.29.0` — no PostgreSQL connection is made
- `python-jsonrpc-server>=0.4.0` — not imported anywhere
- `httpx>=0.25.0` — only used in the unreachable `mcp_server.py`

The `.env.example` lists PostgreSQL connection vars (`PGHOST`, `PGPORT`, etc.) and `REPOSITORY_IMPL=postgres`, but no database code exists.

### 3.4 AWS health check targets wrong path

`infra/aws/modules/ecs_service/main.tf:91` configures the ALB health check to hit `/rpc`, but no route exists at that path. The actual health endpoint is `/health/ping`. The service would fail health checks and be marked unhealthy by the load balancer.

---

## 4. Minor Issues

### 4.1 Dockerfile CMD uses factory function incorrectly

`Dockerfile:18` runs:
```
CMD ["uvicorn", "gateway.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
```

This works because Uvicorn detects callables and invokes them, but the `--factory` flag should be used explicitly for clarity:
```
CMD ["uvicorn", "gateway.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
```

### 4.2 `SECURITY.md` is a template

The security policy file is a generic GitHub template with placeholder text. It has not been customized for this project.

### 4.3 docker-compose.yml uses deprecated version field

`docker-compose.yml:1` uses `version: '3.9'`, which is deprecated in modern Docker Compose. The `version` field can be removed.

### 4.4 `mcp-gateway` console script won't work

`pyproject.toml:25` defines:
```toml
[project.scripts]
mcp-gateway = "gateway.main:create_app"
```

This maps the `mcp-gateway` CLI command to `create_app()`, but `create_app()` returns a FastAPI app object — it doesn't start a server. The console script would create the app and immediately exit.

---

## 5. What Works

Despite the issues, these components function correctly in isolation:

- **`gateway/main.py`** — `create_app()` produces a working FastAPI app with `/health/ping` and a basic `/api/rpc` endpoint (ping + tools/list only)
- **Dockerfile** — builds successfully, container starts and serves the limited `main.py` endpoints
- **Infrastructure templates** — Terraform configs for Azure ACI and AWS ECS are syntactically valid and structurally sound (minus the health check path)
- **CI/CD pipeline** — GitHub Actions workflow will build and push the Docker image (the "test" step is a no-op but doesn't fail)
- **HMAC validation logic** — The signature verification in `mcp_server.py` is correctly implemented, just unreachable

---

## 6. Architecture Assessment

The repository shows a half-completed refactor. The original architecture (visible in git history) had a monolithic `main.py` with domain models, a fake repository, and full tool implementations. Commit `8c214da` replaced this with a simplified `main.py` but left `mcp_server.py` and `mcp_router.py` orphaned. The result is two competing designs:

1. **Simplified inline approach** (`main.py`): Minimal, all-in-one, but only implements ping
2. **Modular approach** (`mcp_server.py` + `mcp_router.py`): Proper separation of concerns, full tool dispatch, env-based auth — but broken by missing models

Neither approach is complete on its own.

---

## 7. Recommendations to Achieve Viability

Ordered by priority:

1. **Restore the domain models** — Either re-add `CloudtalkWebhookPayload`, `Person`, `Consent`, `LeadIngestRequest`, `_FakeRepo`, `env_health`, and `resolve_ohid` to a new `gateway/models.py` module, or inline them into `mcp_server.py`. This fixes the import crash.

2. **Wire up `mcp_router`** — Add `app.include_router(router)` in `create_app()` and remove the duplicate inline `/api/rpc` handler from `main.py`. This enables the full tool dispatch.

3. **Fix authentication** — Remove the hard-coded token from `main.py:24` and use `os.getenv("MCP_AUTH_TOKEN")` consistently. Rotate the exposed token immediately.

4. **Fix the AWS health check path** — Change `/rpc` to `/health/ping` in `infra/aws/modules/ecs_service/main.tf:91`.

5. **Add tests** — Create `gateway/tests/` with at least:
   - Health endpoint test
   - RPC ping test
   - Bearer auth rejection test
   - HMAC signature validation tests
   - Tool dispatch tests

6. **Remove unused dependencies** — Drop `sqlalchemy`, `asyncpg`, and `python-jsonrpc-server` from `pyproject.toml` until they are actually used.

7. **Fix CI test step** — Replace `python gateway/main.py` with `pytest` in `.github/workflows/build-and-push.yml`.

---

## 8. Summary

| Category | Status |
|----------|--------|
| Can the app start? | **No** — ImportError on mcp_server.py |
| Can the app serve requests? | Partially — only /health/ping and limited /api/rpc |
| Are advertised tools functional? | **No** — 5 of 6 tools are non-functional |
| Is auth secure? | **No** — hard-coded token in source |
| Are there tests? | **No** — 0 tests |
| Is CI meaningful? | **No** — test step is a no-op |
| Is infra deployable? | Mostly — AWS health check path is wrong |
| Is the codebase small enough to fix? | **Yes** — ~400 lines total, straightforward to repair |

**Bottom line:** The repository has sound architectural bones and reasonable infrastructure scaffolding, but a botched refactor left it in a broken state. The application cannot start without fixing the import error. With the 7 recommendations above addressed (estimated: moderate effort), this could be a functional MCP gateway.
