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

Set application runtime secrets in the Hugging Face Space settings, not in git:

- `ADMIN_TOKEN`
- `KOMBAI_API_KEYS`
- `TURNSTILE_TOKEN`
- `KOMBAI_INVITE_TOKEN`
- `TEMP_MAIL_API`
- `TEMP_MAIL_ADMIN_AUTH`
- `TEMP_MAIL_DOMAIN`

Do not hardcode access tokens in workflow files or source code.
