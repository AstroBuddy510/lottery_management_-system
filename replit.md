# VS2000 Smart Office

A full-stack lottery operations management platform for 6 user roles: Director, Administrator, Cashier, Gross Entry Team, Wins Entry Team, and Agent.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — JWT signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, path prefix `/api`)
- DB: PostgreSQL + Drizzle ORM
- Auth: JWT (bcryptjs + jsonwebtoken), access token 15m, refresh token 7d (in-memory store)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind CSS + shadcn/ui (port 22333, path `/`)

## Where things live

- `lib/db/src/schema/` — Drizzle ORM table definitions (9 tables)
- `lib/api-spec/openapi.yaml` — OpenAPI 3.1 spec (source of truth, ~40 endpoints)
- `lib/api-zod/src/generated/` — generated Zod validation schemas
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `artifacts/api-server/src/routes/` — Express route handlers (auth, users, agents, settings, sales, entries, payments, calculations, reports, reserve, notifications)
- `artifacts/api-server/src/middleware/auth.ts` — JWT requireAuth + requireRole middleware
- `artifacts/api-server/src/lib/calculator.ts` — smart calculation engine (commission, net gross, reserve, writer balance)
- `artifacts/web/src/` — React frontend (role-based views for all 6 roles)

## Architecture decisions

- Agent creation (`POST /api/agents`) takes an existing `userId` + `agentCode`; the user must be created first via `POST /api/users` with role=agent
- Agent full-code format: `VS-{2-char agentCode}`; writer full-code: `VS-{agentCode}-{4-char writerCode}`
- Cashier time-window enforcement: middleware checks current server time vs `cashier_time_windows` table on every `POST /api/payments` for cashier role
- Calculation formula: Commission = Gross × commissionPct; NetGross = Gross − Commission; Reserve = NetGross × reservePct; WriterBalance = NetGross − Wins − Reserve
- Reserve fund auto-draw: if writerBalance < 0 after calculation, draws from reserve fund and records an allocation
- Entries are locked after `POST /api/calculations/run` and cannot be modified

## Product

- **Director**: full access — org reports, system settings, user management, calculations, reserve fund
- **Administrator**: all operations except org-level settings
- **Cashier**: payment collection (time-window enforced), writer/agent reports
- **Gross Entry Team**: enter and edit gross sales entries
- **Wins Entry Team**: enter and edit wins entries
- **Agent**: sales log entry (mobile/web), notifications inbox

## Test credentials (phone + role + PIN)

| Role | Phone | PIN |
|------|-------|-----|
| Director | 8000001 | 0001 |
| Administrator | 8000002 | 0002 |
| Cashier | 8000003 | 0003 |
| Gross Entry | 8000004 | 0004 |
| Wins Entry | 8000005 | 0005 |
| Agent | 8000006 | 0006 |

## Seeded data

- 1 agent: Pedro Agent (VS-PA) with 2 writers: VS-PA-CK01 (Carlos), VS-PA-LM02 (Luz)
- System settings: 5% commission, 3% reserve, effective 2026-01-01
- Time window: all days 08:00–20:00

## User preferences

_Populate as you build._

## Gotchas

- `CreateAgentBody` Zod schema only accepts `{ userId, agentCode }` — create the agent-role user first
- `UpdateWriterParams` Zod schema uses `id` as the path param name; the Express route must use `/:id` not `/:writerId`
- `RunCalculationsBody` uses `{ date }` not `{ calcDate }` — matches the OpenAPI spec
- Refresh tokens are stored in-memory; server restarts clear all sessions
- Do not run `pnpm dev` at the workspace root — use workflow restart instead

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- OpenAPI spec → `lib/api-spec/openapi.yaml`
- DB schema source of truth → `lib/db/src/schema/`
