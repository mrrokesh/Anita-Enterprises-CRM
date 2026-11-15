# Anita Enterprises CRM

Frontend-only CRM / lead-management app for Anita Enterprises, Salem. Sales staff track leads, follow-ups, customers and stock, and the owner sees sales reports and how each salesperson converts. Built with Vite, React 19, TypeScript, Tailwind v4, react-router, zustand, recharts and i18next (English and Tamil). All data is mocked in `localStorage` behind an async API layer, so a real backend can replace it later.

Live demo: https://ijbrhi0ig0xkyg4jt8zh0pnc.host.rokeshcloud.com

## Run
```bash
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run build` | i18n check, type check, then production build |
| `npm run preview` / `npm start` | Serve the build on port 4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run i18n:check` | English and Tamil keys must match |
| `npm run format` | Prettier |
| `npm run import:products` | Re-import the printer and speaker catalog from anitaenterprises.in (Node only) |

## Features
- **Leads:** pipeline stages, response SLA and escalation, follow-ups that cannot be skipped, Hot / Warm / Cold scoring, lead table and detail view.
- **Inbox and alerts:** simulated new enquiries and "follow-up due" alerts, with a toast and a soft chime (turn the sound off in Settings).
- **Customers:** customers are created from won leads, with search, sort, purchase history, and call / WhatsApp actions.
- **Products:** printers and speakers from the live catalog, plus laptops, desktops and accessories (chargers, RAM, storage, peripherals). Stock editing, stock-out waitlists and in-stock alternatives.
- **Reports (owner):** sales report by period with revenue trend, top products, categories, staff and lead source, CSV export, and conversion by salesperson (filterable by product group).
- **Roles:** the demo login switches between `owner` (sees everything) and `staff` (sees own and unassigned leads).
- **Languages:** English and spoken Tamil. Every visible string goes through `t()`.
- **AI (stub):** rule-based assistant, lead scoring and WhatsApp drafts. No real LLM yet.

## Demo data
On first load, 76 sample leads, 185 products, 14 customers and 4 users are seeded into `localStorage` (the data is fictional). When the seed changes (`SEED_VERSION` in `src/services/api/storage.ts`), browsers reseed automatically. Reset any time in **Settings → Reset demo data**.

## AI (stub)
`src/services/ai/aiClient.ts` exposes `ask({ task, input })` and currently returns mocked responses. **Do not add API keys to the frontend.** Real calls must go through a backend proxy endpoint configured via `VITE_AI_PROXY_URL`; the proxy holds provider keys and handles auth and rate limiting.

## Deploy
The `Dockerfile` builds the app and serves it with `vite preview` on port 4173. The live demo runs on Rokesh Cloud, built from the `main` branch of `mrrokesh/Anita-Enterprises-CRM`.

## Status and next steps
All main pages are built (Dashboard, Leads, Inbox, Customers, Products, Reports, Settings). Not built yet: a real backend, real AI, and an IndiaMART lead import (needs a backend to hold the CRM key). See `CLAUDE.md` for architecture and conventions.
