# ProConnect WMS

Warehouse management web platform for ProConnect Solutions — inventory, rack/bin
locations, orders, and camera-based barcode scanning for put-away and pick,
built on Next.js + Supabase.

One codebase, two ways to deploy it:

- **Managed tier** (your Tier 2 SaaS clients) — you host it, multiple clients
  share one Supabase project, isolated by row-level security.
- **Client-managed tier** (your Tier 3 turnkey clients) — same code, deployed
  into *their* Vercel + Supabase account as a single-tenant instance. See
  "Client-managed deployment" below.

## Stack

- **Framework:** Next.js 14 (App Router)
- **Database/Auth:** Supabase (Postgres + Row Level Security + Auth)
- **Styling:** Tailwind CSS
- **Scanning:** `html5-qrcode` — uses the device camera through the browser,
  so it works on any Android PDA or phone without a native app install

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (pick the
   Singapore region for lowest latency to Penang).
2. Open the SQL Editor and run `supabase/schema.sql` — this creates every
   table, the `apply_scan_event` function, and all Row Level Security
   policies.
3. Go to **Authentication → Users** and create your first user (or invite
   yourself). Copy that user's UUID.
4. Open `supabase/seed.sql`, replace `YOUR-AUTH-USER-UUID` with the UUID you
   just copied, and run it in the SQL Editor. This creates a starter
   organization ("PostHub Simpang Ampat"), one warehouse, a zone, three bin
   locations, and two sample SKUs, and links your user to it as `owner`.
5. Go to **Project Settings → API** and copy the **Project URL** and
   **anon public key** — you'll need these next.

## 2. Run it locally

```bash
npm install
cp .env.example .env.local
# paste your Supabase URL + anon key into .env.local
npm run dev
```

Visit `http://localhost:3000`, sign in with the user you created, and you
should see the seeded warehouse data.

## 3. Deploy — managed tier (your hosted SaaS)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. Add the two environment variables from step 1.5 above
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy. Vercel builds and gives you a production URL.
5. **Onboarding a new managed client** = insert one row into `organizations`,
   one row into `org_members` linking their user, and a `warehouses` row.
   No redeploy needed — RLS keeps their data isolated from every other
   tenant sharing this same deployment.

## 4. Deploy — client-managed tier (turnkey / dedicated)

Same repo, different accounts — this is the "dedicated instance" model we
scoped for Tier 3 clients who want their data on infrastructure billed to
them, without you maintaining a second codebase:

1. Have the client create their own free Supabase project and Vercel
   account (or create it for them under their billing).
2. Run `supabase/schema.sql` on *their* Supabase project.
3. Deploy this same repo to *their* Vercel project, pointed at their
   Supabase URL/key.
4. Their `organizations` table will only ever have one row — it's
   effectively single-tenant, but it's the exact same code you already
   maintain, so a bug fix or feature you ship for the managed tier can be
   pushed to their repo too.
5. If a client insists on a physical on-prem server rather than any cloud
   account, that's a materially bigger lift — self-hosted Supabase (Docker)
   instead of Supabase Cloud. Don't commit to this for a client until you've
   packaged and tested that Docker path once internally.

## Project structure

```
app/
  login/              sign-in page
  (app)/              authenticated shell (sidebar + all screens)
    dashboard/         KPI overview + recent scan activity
    inventory/         SKU list with stock on hand
    locations/         warehouse → zone → bin hierarchy
    orders/            sales orders by channel/status
    scan/               camera put-away / pick console
components/           shared UI (Sidebar, ScanConsole, CameraScanner, ...)
lib/
  supabase/           browser + server Supabase clients, hand-written types
  org.ts              resolves the signed-in user's organization
supabase/
  schema.sql          full schema + RLS — run this first
  seed.sql            optional starter data for your first login
```

## What's intentionally NOT in this build yet

Scoped out of this pass so the core platform could ship — pick these up as
the next phases we already mapped out:

- **E-commerce sync** (Shopee/Lazada/TikTok Shop) — deferred to reduce
  integration risk in the MVP; `sales_orders.platform` already has the
  column to receive these once you build the connectors.
- **Native Android PDA app** — the `/scan` screen already covers put-away/
  pick via the browser camera on any Android device, which is the
  lower-risk v1 path we discussed. A dedicated Flutter/React Native app
  (offline-first, hardware scanner trigger support) is a separate build.
- **Label printing (TSPL/ZPL)** — not started.
- **CSV/batch import** for legacy-ERP clients — not started; flagged in the
  original risk matrix as a Phase 1 item worth prioritizing next.
- **Purchase orders / receiving flow** — the `purchase_orders` table exists
  in the schema but has no UI yet; only the sales-order/pick side is built.

## Security note

This was built and type-checked against **Next.js 14.2.35**, which patches
the December 2025 React Server Components vulnerabilities
(CVE-2025-55183/55184/66478). Keep Next.js current — `npm outdated next` and
check https://nextjs.org/blog before any future upgrade.
