# Repository Guidelines

## Project Structure & Module Organization
- gateway/ holds the FastAPI application. gateway/main.py exposes create_app(); keep new routers or services inside this package. Tests belong in gateway/tests/.
- .github/ stores CI workflows, infra/ contains Terraform for Azure plus AWS modules (infra/aws/modules). Docker artifacts (Dockerfile, docker-compose.yml) are at the repo root.
- Architecture docs and schema notes live alongside the Final Schema bundle in OneDrive.

## Build, Test, and Development Commands
`
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[test]
python gateway/main.py            # run internal async tests
uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000
ngrok http 8000                   # temp public URL for webhooks
docker compose build && docker compose up
cd infra && terraform init && terraform plan
`

## Coding Style & Naming Conventions
- Python 3.9+, 4-space indentation, Black-style formatting. Snake_case for functions/variables; UpperCamelCase for Pydantic models.
- Keep configuration in environment variables (.env.example shows required keys). Never commit secrets.
- Organize routers/services under gateway/ and prefer explicit imports to avoid circular dependencies.

## Testing Guidelines
- Legacy async tests run via python gateway/main.py. Add new suites with pytest under gateway/tests/test_<feature>.py.
- Aim for >80% coverage on JSON-RPC handlers, OHID logic, and webhook verification. Use pytest/pytest-asyncio for async scenarios.

## Commit & Pull Request Guidelines
- Use conventional, descriptive commits (feat: add notion webhook router, fix: enforce twilio signature). Keep commits scoped and rebased before merging.
- PRs should include: summary, linked issue/Notion task, verification steps (commands run), and screenshots/logs when touching webhook flows or infrastructure.

## Security & Configuration Tips
- Store secrets in Azure Key Vault or AWS Secrets Manager; .env is for local use only.
- When exposing webhooks, rely on ngrok Pro or your cloud ingress and note the URL swap in Notion so automations stay aligned.
- Always run 	erraform plan before pply, and allow the GitHub workflow to build/push GHCR images used in deployments.
