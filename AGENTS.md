# Repository Guidelines

## Project Structure & Module Organization
- gateway/ holds the MCP server application. gateway/server.py defines the FastMCP instance with all tool registrations. Business logic lives in gateway/services/. Domain models in gateway/models.py. Tests in gateway/tests/.
- .github/ stores CI workflows, infra/ contains Terraform for Azure plus AWS modules (infra/aws/modules). Docker artifacts (Dockerfile, docker-compose.yml) are at the repo root.

## Build, Test, and Development Commands
```
python -m venv .venv
source .venv/bin/activate
pip install -e .[test]
pytest gateway/tests/ -v                          # run tests
mcp run gateway/server.py                         # stdio transport (local)
python -m gateway.server                          # Streamable HTTP (remote)
mcp dev gateway/server.py                         # dev inspector
python -m gateway.healthcheck                     # env health check
docker compose build && docker compose up         # Docker
cd infra && terraform init && terraform plan      # Terraform
```

## Coding Style & Naming Conventions
- Python 3.10+, 4-space indentation, Black-style formatting. Snake_case for functions/variables; UpperCamelCase for Pydantic models.
- Keep configuration in environment variables (.env.example shows required keys). Never commit secrets.
- Organize services under gateway/services/ and prefer explicit imports to avoid circular dependencies.

## Testing Guidelines
- All tests use pytest/pytest-asyncio under gateway/tests/test_<feature>.py.
- Aim for >80% coverage on MCP tool handlers, OHID logic, and webhook verification.
- Use `asyncio_mode = "auto"` (configured in pyproject.toml).

## Commit & Pull Request Guidelines
- Use conventional, descriptive commits (feat: add notion webhook router, fix: enforce cloudtalk signature). Keep commits scoped and rebased before PRs.
- PRs should include: summary, linked issue/Notion task, verification steps (commands run), and screenshots/logs when touching webhook flows or infrastructure.

## Security & Configuration Tips
- Store secrets in Azure Key Vault or AWS Secrets Manager; .env is for local use only.
- The MCP_AUTH_TOKEN env var is used for bearer token authentication. Never hard-code tokens.
- Always run `terraform plan` before `apply`, and allow the GitHub workflow to build/push GHCR images used in deployments.
