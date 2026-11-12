# Contributing

Thanks for your interest in improving Trang Sach. Bug reports, documentation improvements, and focused pull requests are welcome.

## Before you start

- Check existing issues and pull requests to avoid duplicating work.
- For a large change, open an issue first to discuss the approach.
- Never include real credentials, private keys, user documents, or personal data in a commit or issue.

## Local setup

Requirements: Node.js 22.13 or newer and npm.

1. Fork the repository and create a branch from `main`.
2. Install the locked dependencies:

   ```bash
   npm ci
   ```

3. Copy `.env.example` to `.env.local` and configure a Supabase project using a public anon/publishable key only. Never put a `service_role` or secret key in frontend variables.
4. Start the development server:

   ```bash
   npm run dev
   ```

## Make and verify changes

- Keep changes focused and follow existing React, JavaScript, and CSS patterns.
- Preserve access controls and Row Level Security when changing Supabase queries or schema.
- For database changes, include an ordered migration under `supabase/migrations/` and document any manual Supabase steps.
- Do not commit generated output, local environment files, logs, or downloaded documents.
- Before opening a pull request, run:

  ```bash
  npm run build
  npm audit --omit=dev
  git diff --check
  ```

- If your change affects a reader format or mobile layout, test that path at desktop and mobile sizes when possible.

## Pull requests

- Use the pull request template.
- Describe the user-visible change, how it was tested, and any deployment or migration steps.
- Include screenshots for visual changes when useful, and avoid screenshots containing private documents or credentials.
- Keep each pull request reviewable; do not combine unrelated changes.

## Security reports

Do not report vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md) instead.

