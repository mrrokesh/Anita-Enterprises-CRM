# Anita Enterprises CRM

CRM for Anita Enterprises, Salem. Sales staff track leads, follow-ups, customers and stock. The owner sees sales reports and how each salesperson converts. The app is in English and spoken Tamil.

```
frontend/   Vite, React, TypeScript, Tailwind CSS
backend/    Node.js, Express
postgres    Docker Compose (database anita_crm)
```

The earlier UI demo is still at https://ijbrhi0ig0xkyg4jt8zh0pnc.host.rokeshcloud.com. This repository now includes the API, so new deploys build `frontend/` and run `backend/` with PostgreSQL.

## Run

From this folder, with [Docker](https://www.docker.com/) running:

```powershell
docker compose up -d
Copy-Item backend\.env.example backend\.env
npm install --prefix backend
npm install --prefix frontend
npm run dev:api
```

In a second terminal:

```powershell
npm run dev:web
```

Open http://localhost:5173. The first visit copies the demo seed into PostgreSQL. Sign in by choosing a staff member. Settings → Reset demo data reloads that seed.

PostgreSQL is published on port **5434** so it does not collide with a database already using 5432 or 5433.

API health check: http://localhost:8000/api/health

Frontend scripts, run from `frontend/`:

| Script | What it does |
| --- | --- |
| `npm run build` | i18n check, type check, then production build |
| `npm run preview` / `npm start` | Serve the build on port 4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run i18n:check` | English and Tamil keys must match |
| `npm run format` | Prettier |
| `npm run import:products` | Re-import the printer and speaker catalog from anitaenterprises.in |

## Features

- **Leads:** pipeline stages, response SLA and escalation, follow-ups, Hot / Warm / Cold scoring.
- **Inbox:** new enquiries and follow-up alerts, with a toast and a soft chime.
- **Customers:** created from won leads, with purchase history and call / WhatsApp actions.
- **Products:** printers, speakers, laptops, desktops and accessories. Stock editing, waitlists and in-stock alternatives.
- **Reports (owner):** revenue, top products, staff, lead source, CSV export, and conversion by salesperson.
- **IndiaMART:** buyers arrive as leads and customers. The Pull API key stays on the server.
- **Tally:** file import, a daily pull, or posting invoices back. See below.
- **Roles:** `owner` sees everything. `staff` sees own and unassigned leads.
- **AI:** rule-based assistant, lead scoring and WhatsApp drafts. A real model would be called from the backend.

## Configuration

| File | Purpose |
| --- | --- |
| `backend/.env` | `PORT` (8000) and `DATABASE_URL` |
| `frontend/.env` | Optional. Defaults to `VITE_API_BASE_URL=http://localhost:8000/api` |

`frontend/.env.example` and `backend/.env.example` list the variables. Do not put provider API keys in any `VITE_` variable.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/health` | Database connectivity |
| GET | `/api/admin/status` | `{ seeded }` |
| POST | `/api/admin/seed` | Replace all CRM rows |
| GET | `/api/:resource` | `leads`, `products`, `customers`, `users` |
| GET | `/api/:resource/:id` | One record |
| POST | `/api/:resource` | Create |
| PATCH | `/api/:resource/:id` | Update |
| DELETE | `/api/:resource/:id` | Delete |

List query: `search`, `filters` (JSON object), `sortBy`, `sortDir`, `page`, `pageSize`.

## IndiaMART

The owner sets this under Settings. The Pull API key is saved on the server. Buyers arrive as leads and as customers.

IndiaMART push needs a public `https` address. The URL shown in Settings includes a token and works after this CRM is on the internet.

## Tally

Settings offers three ways to keep the books and the CRM together. Tally has to be open with the company loaded.

| Mode | What it does |
| --- | --- |
| Export and import | Load a Stock Summary and Sales Register exported from Tally as XML or Excel. No live link. |
| One-way sync | Pull new customers, stock, and sales into the CRM. Optional daily run while this server and Tally are both open. |
| Two-way sync | Also post won deals and new IndiaMART customers into Tally. Stock item names, the voucher type, and the GST ledger must match the company. Daily posting stays off until it is turned on. |

Tally listens on port **9000** (`http://127.0.0.1:9000` on the same PC). On a shop network, point the CRM at the computer where the company stays open, for example `http://192.168.1.10:9000`. In Tally.ERP 9 that switch is **F12 → Advanced Configuration** (Tally acts as Server or Both). Leave port 9000 on the shop network.

Port **9999** is only the Tally licence server. Several computers sharing one Gold licence use that port. It is separate from the CRM connection.

## Deploy

`frontend/Dockerfile` builds the web app and serves it on port 4173. The API is `backend/` and needs `DATABASE_URL`. The live demo linked above was built when this repository was the frontend only.
