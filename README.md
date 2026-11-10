# Trang Sách (MyLibrary)

A personal, cloud-backed digital library for the web. Organize books and study materials into folders, search your collection, mark favorites and read status, and read PDF, EPUB, and AZW3 files directly in the browser with a full-screen reader that remembers where you stopped.

## Features

- **Library management**: folders, search, favorites, and read status.
- **Uploads**: single files, multiple files, or whole folders (up to 50 MB per file), with duplicate detection by SHA-256.
- **Built-in reader**: PDF, EPUB, AZW3 (non-DRM), images, and common text files.
- **Reading progress**: synced across devices through Supabase; kept locally when offline.
- **Bookmarks, notes, and in-document search** for PDF, EPUB, AZW3, and plain text.
- **Offline reading**: optionally keep files in browser storage (IndexedDB) on the current device.
- **Responsive design**: optimized for phones and tablets, with touch and swipe navigation and adjustable font size and themes (light, sepia, dark).
- **Optional proof of integrity**: anchor a file hash on an Ethereum testnet (Sepolia). Only hashes are published, and only when you choose to.

## Tech stack

- React and Vite (single-page app with separate library and reader entry points)
- Supabase: Auth, PostgreSQL with Row Level Security, and private Storage
- Nginx (Docker) to serve the production build, with a small Node.js API for health checks
- Redis (connectivity check only in the current version)
- GitHub Actions for CI and GitHub Pages deployment

## Project structure

- `src/App.jsx`: library page composition and state coordination.
- `src/components/`: sidebar, toolbar, document cards, lists, dialogs, and toasts.
- `src/hooks/`: authentication (`useAuth.js`) and library data/upload logic (`useLibrary.js`).
- `src/lib/`: Supabase client setup and data mapping helpers.
- `src/reader/`: reader page, EPUB/PDF/AZW3 viewers, and reading-progress cache.
- `server/`: health API and Redis connection used by the Docker backend.
- `docker/`, `Dockerfile`, `docker-compose.yml`: container setup.
- `contracts/FileHashRegistry.sol`: sample hash registry contract.
- `supabase-schema.sql` and `supabase/migrations/`: database schema, RLS, and storage policies.

## Getting started

Requirements: Node.js 22.13 or newer.

```bash
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm install
npm run dev
```

To test a production build locally:

```bash
npm run build
npm run preview
```

## Running with Docker

```bash
cp docker.env.example docker.env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in docker.env
docker compose --env-file docker.env up --build -d
```

The app is then available at `http://localhost:8080`. Nginx serves the frontend and forwards `/api/*` to the internal API service. Check the health endpoint at `http://localhost:8080/api/health`.

The Redis URL is configured with `REDIS_URL` in `docker.env`. Use a Redis instance you control, and secure it with authentication and a firewall. Do not expose it to the public internet.

Useful commands:

```bash
docker compose --env-file docker.env ps
docker compose --env-file docker.env logs api
docker compose down
```

Vite embeds `VITE_*` values into the frontend at build time, so rebuild after changing them.

## Supabase setup

1. Create a Supabase project.
2. For a new project, run `supabase-schema.sql` in the SQL Editor. For an existing project, apply the files in `supabase/migrations/` in chronological order.
3. In **Authentication → Settings**, enable sign-ups as needed and configure the email provider. Email confirmation is not required by the app.
4. In **Authentication → URL Configuration**, add your local and deployed site URLs to the redirect list.

Only the public anon/publishable key belongs in the frontend. Never use the `service_role` key or any secret key in the browser, Docker images, or GitHub Actions variables. Data protection depends on RLS, Storage policies, and Supabase project settings, so review them before publishing.

## Deployment (GitHub Pages)

- `.github/workflows/ci.yml` runs the build and dependency audit on pull requests and pushes to `main`.
- `.github/workflows/deploy.yml` builds and deploys to GitHub Pages on pushes to `main` or on manual runs.

In the repository settings, add these **Actions variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_FILE_HASH_REGISTRY_ADDRESS` (optional)

Then go to **Settings → Pages**, and set the source to **GitHub Actions**.

## Security and privacy

- Connections to Supabase use TLS. Files are stored in a private Storage bucket, and each row is restricted to its owner through RLS (`auth.uid()`).
- The schema revokes table access from the `anon` role and grants access only to authenticated users.
- The production build adds a Content Security Policy and a Referrer Policy. The Docker Nginx configuration also sends headers such as `X-Frame-Options` and `X-Content-Type-Options`, and runs as a non-root user with a read-only filesystem.
- This is not end-to-end encryption. Supabase processes data after authentication. Encryption at rest is managed by Supabase; review its documentation for details.
- Offline copies in IndexedDB are not encrypted by the app. Clear them before sharing a device.
- Nginx rate limiting is a basic protection and is not a DDoS defense. For public deployments, put a CDN or WAF in front of the site, and set quotas and alerts in Supabase.
- Do not commit `.env.local`, `docker.env`, or `supabase-config.js`. They are ignored by Git.

## Blockchain proof of integrity (optional)

Only file hashes are considered, never file names, account data, or content. A public hash can still reveal that someone owns a known file, so anchoring is opt-in.

1. Deploy `contracts/FileHashRegistry.sol` to the Sepolia testnet (for example, with Remix and Solidity 0.8.24).
2. Set the contract address in `VITE_FILE_HASH_REGISTRY_ADDRESS` and rebuild.
3. In the reader, use the fingerprint icon to sign and anchor a hash with your wallet. The transaction pays gas in Sepolia test ETH.

Never put a private key into the application. This is a sample contract: review it and your deployment process before using a mainnet.

## Limitations

- Supported inline formats: PDF, EPUB, AZW3 (non-DRM), images, and some text files. Other formats can be downloaded.
- PDF search jumps to the page with a match but does not highlight the text.
- Reading progress: PDF by page, EPUB by location, AZW3 by chapter percentage, and text by scroll position.

## License

No license has been specified yet.
