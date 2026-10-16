# Lepide Account

A Node.js application with signup, login, remembered sessions, a protected account page, and logout. The frontend uses plain HTML and the canonical Lepidus components from [design.md](design.md).

## Run

Requires **Node.js 24 or later**. Install dependencies with `npm install` (already installed in this workspace).

```powershell
npm start
```

Open http://localhost:5180. Change `PORT` and `APP_ORIGIN` in your local `.env` to use a different port.

```powershell
$env:PORT = '5180'
npm start
```

The VS Code task **Start Lepide on 5180** also loads `.env`. Use `npm run dev` for automatic backend restarts during development.

## Connect Supabase Database

This application uses **database tables only**, not Supabase Auth, email confirmation, or Supabase API keys.

1. In your Supabase project, open **Connect**, select **Session pooler**, and copy the PostgreSQL connection URI. Replace the password placeholder locally with your database password, URL-encoding any special characters. Do not share this URI or password in chat.
2. In the existing local `.env`, set `DATABASE_URL` to that URI. Leave `PORT=5180` and `APP_ORIGIN=http://localhost:5180` for local use. A blank `DATABASE_URL` keeps SQLite mode active; a configured but unavailable database fails startup instead of falling back silently.
3. Run `npm run db:setup`. This creates `public.app_users` and `public.app_sessions`, their indexes, and RLS restrictions. It can be run again without deleting accounts. It expects the Session pooler's administrative database credentials; existing tables must match the schema.
4. Stop the old server with Ctrl+C and run `npm start`. The startup log should say **Supabase PostgreSQL**. Create an account in the app, then check **Table Editor > app_users**.

The setup SQL is in [supabase/schema.sql](supabase/schema.sql). Its `expires_at` column is `timestamptz`, matching the previously suggested SQL. The backend converts its session expiry timestamps appropriately. The setup does not migrate existing SQLite users.

The connection uses TLS with certificate verification enabled by default. If your environment requires Supabase's downloadable CA certificate, download it from your project settings and set `NODE_EXTRA_CA_CERTS` in your shell to its local path before starting Node.

For a temporary workaround, run `$env:DATABASE_TLS_SKIP_VERIFY = 'true'` before setup and startup in PowerShell. Traffic remains encrypted, but the database server's identity is not verified, leaving the connection vulnerable to interception. The app prints a warning. Remove the override with `Remove-Item Env:DATABASE_TLS_SKIP_VERIFY` and restart after configuring a trusted CA. The override is not saved in `.env` automatically.

Only `.env.example` should be committed. `.env` is ignored. Neither the connection URI nor any database credentials are sent to the browser.

## Vercel Deployment

The Node entry point exports a default request handler for Vercel and only listens on a local port outside Vercel. `vercel.json` includes the HTML pages and frontend assets in the function bundle. Use Node.js 24 in the project settings.

In **Vercel > Project > Settings > Environment Variables**, configure `DATABASE_URL` with your Supabase Session pooler URI for the appropriate environments. The local `.env` is not committed or uploaded. The deployed handler refuses to fall back to SQLite when this variable is missing.

Set `APP_ORIGIN` to your exact production origin (for example, `https://your-project.vercel.app`), without a trailing slash. Alternatively leave it unset to validate same-origin requests against the request host. Do not copy the localhost value to Vercel. No `PORT` setting is needed.

Certificate verification is enabled by default. For the explicitly requested temporary Vercel workaround, set `DATABASE_TLS_SKIP_VERIFY=true` in the relevant Vercel environments and redeploy this code. This disables certificate and hostname verification for the database connection only, including in production, and ignores `DATABASE_CA_CERT` while enabled. It increases interception risk; restore verification by removing the flag and configuring the trusted CA below. Never set the global `NODE_TLS_REJECT_UNAUTHORIZED=0`.

If logs show `SELF_SIGNED_CERT_IN_CHAIN`, download the database CA certificate from your Supabase project's database SSL settings. In Vercel environment variables, set `DATABASE_CA_CERT` to the complete PEM file contents, including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`, for each relevant deployment environment. Paste the contents, not the file path, without surrounding quotes. Both real newlines and literal `\n` separators are supported. Use only a CA obtained from your trusted project settings, not an unverified certificate copied from the failing connection. Redeploy after saving. This adds the configured trust anchor while keeping certificate and hostname verification enabled.

Redeploy after changing environment variables. The default-handler regression tests check page serving, bundled asset paths, unauthenticated account protection and the missing-database response; they do not perform a hosted Vercel deployment. The in-memory IP rate limiter is per function instance, so shared rate limiting is still needed for production-scale deployment.

## Application Routes

- `/login`: email/password sign-in and optional 30-day remembered session.
- `/signup`: full name, email, password, and password confirmation. Signup signs the user in automatically.
- `/account`: authenticated account details and sign-out. Unauthenticated visitors are redirected to login.

Signup passwords must contain 12 to 128 characters. Email addresses are normalized to lowercase. Duplicate accounts, invalid credentials, server failures, and invalid fields have explicit error states. Submitting disables the action until the response arrives.

## Storage And Security

When `DATABASE_URL` is configured, accounts and sessions are stored in Supabase PostgreSQL. Otherwise the first launch creates `data/accounts.sqlite`, which is ignored by Git. Accounts and sessions persist across server restarts. Passwords use salted scrypt hashes; random session tokens are stored only as SHA-256 hashes in the database and sent in HttpOnly, SameSite cookies. Non-remembered sessions expire server-side after 12 hours; remembered sessions expire after 30 days. Logout invalidates the current session.

Authentication requests are limited to 30 attempts per IP per 15 minutes. The server validates request origins, limits JSON body size, uses parameterized SQL, and sends a Content Security Policy. It binds to loopback for local use.

For deployment, use HTTPS, set `NODE_ENV=production` to require Secure cookies, and set `APP_ORIGIN` to the public origin (for example, `https://accounts.example.com`). Persist and protect the database directory. A multi-instance deployment needs shared rate limiting and an appropriate database strategy. Email verification, password recovery, MFA, and administrator management are not implemented.

## Design Contract

- Canonical Lepidus Input, Button, Checkbox, Dropdown, Link, Card, and text-only Message anatomy.
- Versioned Lepidus CSS and JavaScript are loaded from the required CDN; internet access is needed for these assets and the Lepide monogram.
- Custom CSS targets layout wrappers only, with existing design tokens and no component overrides.
- Light, dark, and high-contrast modes use `data-theme`. The official dropdown script owns open/close and selection; the app listens for `lp-dropdown-change` only. Appearance preferences, not credentials, are saved in local storage.
- Labels, helper/error associations, main landmarks, keyboard focus, loading, disabled, and error states are included.
- System gap: the contract has no authentication-specific page archetype. These screens compose the existing credentials/setup form components; no new `lp-*` classes are introduced.

## Verification

```powershell
npm test
```

Tests cover signup/login/logout, invalid input, duplicate email, session rotation, restart persistence, request-origin protection, throttling, PostgreSQL query binding and timestamp conversion, verified TLS configuration, documented class names, existing tokens, and label associations. Authentication regressions use isolated SQLite databases; PostgreSQL adapter tests use a mocked driver. A live Supabase connection cannot be verified until `DATABASE_URL` is configured. The design-system source repository and its official `scripts/validate-lp-html.mjs` validator are not included; the local contract checks are not a substitute for that validator.

Browser checks cover the real signup/sign-in/sign-out flow, incorrect passwords, mismatched confirmation, remembered sessions after reload, desktop/mobile layouts, brand images, and all three themes.