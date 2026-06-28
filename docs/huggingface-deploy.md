# Hugging Face Space Deployment

This repo includes `.github/workflows/deploy-hf-space.yml`.

The workflow:

1. Builds this repository's Docker image with GitHub Actions.
2. Pushes the image to GitHub Container Registry (`ghcr.io`).
3. Pushes a small Docker Space wrapper to Hugging Face:

```dockerfile
FROM ghcr.io/<owner>/<repo>:<commit-sha>
ENV PORT=7860
ENV DATA_DIR=/data
EXPOSE 7860
```

## Required GitHub Settings

Create these in the GitHub repository:

- `HF_TOKEN`: GitHub secret. Use a Hugging Face token with write access.
- `HF_SPACE_ID`: GitHub variable or secret. Format: `username/space-name`.

The target Hugging Face Space should already exist and use the Docker SDK.

## Required GHCR Setting

The Hugging Face builder must be able to pull the built image from GHCR.
Set the GHCR package visibility to public, or use another registry that your
Space can pull from.

## Runtime Secrets

Set application runtime secrets as GitHub repository secrets. The deploy
workflow syncs non-empty values to Hugging Face Space secrets:

- `ADMIN_TOKEN`
- `KOMBAI_API_KEYS`
- `TURNSTILE_TOKEN`
- `KOMBAI_INVITE_TOKEN`
- `TEMP_MAIL_ADMIN_AUTH`
- `PROXY_LIST`

Set non-secret runtime config as GitHub repository variables. The deploy
workflow syncs non-empty values to Hugging Face Space variables:

- `ACCOUNT_POOL_SIZE`
- `AUTO_EMAIL_PREFIX`
- `AUTO_FILL_ON_STARTUP`
- `AUTO_FILL_STARTUP_DELAY_MS`
- `KOMBAI_AUTH_TIMEOUT_MS`
- `KOMBAI_AUTH_URL`
- `KOMBAI_AUTH_CONNECT_URL`
- `TEMP_MAIL_API`
- `TEMP_MAIL_DOMAIN`
- `PLAYWRIGHT_CHROMIUM_ARGS`

Do not hardcode access tokens in workflow files or source code.
