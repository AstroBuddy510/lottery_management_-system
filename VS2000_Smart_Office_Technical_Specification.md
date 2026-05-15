# VS2000 Smart Office — Technical Specification
**Version:** 1.0  
**Date:** May 15, 2026  
**Classification:** Internal Architecture Document

---

## 1. Executive Summary

VS2000 Smart Office is a multi-role lottery management platform serving field agents, cashiers, data entry teams, administrators, and executive directors. The system supports the full lifecycle of lottery operations: ticket sales tracking, payment collection, gross/wins data entry, commission and reserve fund calculations, performance reporting, and internal communications.

---

## 2. User Roles & Permissions

### 2.1 Role Hierarchy

```
Director
  └── Administrator
        ├── Cashier
        ├── Gross Entry Team
        ├── Wins Entry Team
        └── Agent
              └── Writer(s)
```

### 2.2 Role Definitions

| Role | Platform | Primary Responsibilities |
|---|---|---|
| **Director** | PC / Tablet | Read-only executive view of all operations, financials, performance, and reserve status |
| **Administrator** | PC / Tablet | System configuration, code assignment, user management, notifications, percentage settings |
| **Cashier** | PC / Tablet | Receive agent payments within time-restricted windows; post payment records |
| **Gross Entry Team** | PC / Tablet | Input daily gross sales totals per writer/agent |
| **Wins Entry Team** | PC / Tablet | Input daily wins totals per writer/agent |
| **Agent** | Mobile only | Log sales activity, upload ticket images, view own performance summary |

### 2.3 Permission Matrix

| Feature | Director | Admin | Cashier | Gross Entry | Wins Entry | Agent |
|---|---|---|---|---|---|---|
| View all agent/writer performance | ✓ | ✓ | — | — | — | — |
| View own performance | ✓ | ✓ | — | — | — | ✓ |
| Set commission/reserve percentages | — | ✓ | — | — | — | — |
| Assign agent/writer codes | — | ✓ | — | — | — | — |
| Send notifications | — | ✓ | — | — | — | — |
| Post payment records | — | — | ✓ | — | — | — |
| Input gross totals | — | — | — | ✓ | — | — |
| Input wins totals | — | — | — | — | ✓ | — |
| Upload ticket images | — | — | — | — | — | ✓ |
| Log sales | — | — | — | — | — | ✓ |
| View reserve fund status | ✓ | ✓ | — | — | — | — |
| Manage cashier time windows | — | ✓ | — | — | — | — |
| View all notifications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 3. Code Structure

### 3.1 Coding Convention

Each code is a concatenated identifier built hierarchically:

```
[Organization Prefix] - [Agent Code] - [Writer Code + Sequence]
Example: VS-AB-CK01
```

| Segment | Description | Example |
|---|---|---|
| Organization Prefix | Fixed 2-letter org code set by Administrator | `VS` |
| Agent Code | 2-letter code assigned to the agent by Administrator | `AB` |
| Writer Code | 2-letter abbreviation + 2-digit sequence number assigned per writer under that agent | `CK01` |

**Rules:**
- Organization prefix is system-wide and set once by the Administrator.
- Agent codes are unique across the organization (no two agents share a code).
- Writer codes are unique within an agent (same writer abbreviation may appear under different agents as long as the full concatenated code is unique).
- Codes are immutable once assigned and active; deactivation is the only change allowed.

---

## 4. Core Modules

### 4.1 Authentication & Session Management

- Role-based login with JWT access tokens and refresh tokens.
- Agents authenticate exclusively on mobile (React Native / Expo app).
- PC/tablet roles authenticate via web browser.
- Session timeouts configurable by role.
- Multi-device login: Agents may use multiple devices; PC roles are single-session.

### 4.2 Agent & Writer Management

- Administrator creates agent accounts, assigns unique agent codes.
- Agents can register writers under their account; Administrator assigns writer codes.
- Full hierarchy is reflected in the concatenated writer code (e.g., `VS-AB-CK01`).
- Deactivation preserves historical data; deactivated codes cannot be reused.

### 4.3 Sales Logging (Agent — Mobile)

- Agents log individual ticket sales with: date, writer code, game type, and ticket amount.
- Image upload for physical ticket stubs (stored in object storage, linked to sales record).
- Offline-capable: sales logged offline sync on reconnect.
- Agents see their own daily/weekly summary: gross sales, calculated net, wins, balance due.

### 4.4 Payment Collection (Cashier)

- Cashiers record payments received from agents.
- **Time Windows:** Administrator defines daily payment entry windows (e.g., 09:00–12:00). Outside these windows, the payment entry form is locked.
- Cashier logs: agent code, amount received, date/time, notes.
- Payments are posted against the agent's outstanding balance.
- Cashier cannot modify or delete past payment records; only Administrators can void entries.

### 4.5 Gross Entry (Gross Entry Team)

- Entry form: select date, select writer code, enter gross sales total.
- Validation: system warns if entry deviates significantly from agent-logged data (configurable tolerance).
- Entries can be edited until daily cut-off time; locked after cut-off.
- Bulk import via CSV supported.

### 4.6 Wins Entry (Wins Entry Team)

- Entry form: select date, select writer code, enter wins total for the day.
- Same locking mechanism as gross entry.
- Bulk import via CSV supported.

### 4.7 Smart Calculations Engine

All calculations are driven by Administrator-configured percentages stored in a `system_settings` table. Percentages can be updated and take effect on the next processing cycle without redeployment.

#### 4.7.1 Per-Writer Daily Calculation

```
Gross Sales       = (entered by Gross Entry Team)
Commission        = Gross Sales × Commission % (set by Admin)
Net Gross         = Gross Sales − Commission
Wins              = (entered by Wins Entry Team)
Reserve Deduction = Net Gross × Reserve %  (set by Admin)
Writer Balance    = Net Gross − Wins − Reserve Deduction
```

#### 4.7.2 Per-Agent Rollup

```
Agent Gross   = Σ(Writer Gross) for all writers under agent
Agent Net     = Σ(Writer Net Gross)
Agent Wins    = Σ(Writer Wins)
Agent Reserve = Σ(Writer Reserve Deduction)
Agent Balance = Agent Net − Agent Wins − Agent Reserve
```

#### 4.7.3 Organization Reserve Fund

```
Total Reserve = Σ(Reserve Deduction) across all agents for a given period
```

- Reserve fund balance is tracked cumulatively.
- Smart Allocation: when a wins payout is pending and an agent's individual balance is insufficient, the system draws from the organization reserve fund to cover the shortfall, records the allocation event, and notifies the Administrator.

### 4.8 Reserve Fund & Smart Allocation

- Reserve fund is displayed in real-time to Director and Administrator.
- Allocation events are logged: date, agent, writer, amount drawn, remaining reserve.
- Allocation rules (configurable by Admin):
  1. First, apply the agent's own net balance.
  2. If insufficient, draw the shortfall from the organization reserve fund.
  3. If reserve fund is also insufficient, flag as "Pending — Insufficient Funds" and notify Administrator and Director.
- Monthly reserve fund reports auto-generated.

### 4.9 Performance Reporting

- **Writer Report:** Individual gross, net, wins, reserve contribution, balance for any date range.
- **Agent Summary Report:** All writers under one agent, aggregated.
- **Organization Report (Director view):** All agents side-by-side, with totals and reserve status.
- Reports are filterable by: date range, agent code, writer code, game type.
- Export formats: PDF, CSV.

### 4.10 Communications & Notifications

- Administrator composes messages targeting: all agents, specific agent, all writers under an agent, or all registered users.
- Message types: Announcement, Alert, Reminder.
- Delivery channels: in-app notification, push notification (mobile agents).
- Message log visible to Administrator and Director.
- Agents see their notification inbox on mobile.
- Unread count badge on mobile and web.

---

## 5. Data Models

### 5.1 Core Entities

#### `organizations`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR(100) | |
| prefix | CHAR(2) | e.g., `VS` — immutable |
| created_at | TIMESTAMPTZ | |

#### `users`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID FK | |
| full_name | VARCHAR(100) | |
| email | VARCHAR(100) | Unique |
| password_hash | TEXT | |
| role | ENUM | `director`, `administrator`, `cashier`, `gross_entry`, `wins_entry`, `agent` |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |
| last_login | TIMESTAMPTZ | |

#### `agents`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| agent_code | CHAR(2) | Unique within org, immutable once active |
| full_code | VARCHAR(10) | e.g., `VS-AB` — computed |
| is_active | BOOLEAN | |

#### `writers`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_id | UUID FK → agents | |
| writer_code | VARCHAR(4) | e.g., `CK01` — unique per agent |
| full_code | VARCHAR(12) | e.g., `VS-AB-CK01` — computed |
| full_name | VARCHAR(100) | |
| is_active | BOOLEAN | |

#### `system_settings`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID FK | |
| commission_pct | DECIMAL(5,4) | e.g., `0.2500` = 25% |
| reserve_pct | DECIMAL(5,4) | e.g., `0.1000` = 10% |
| updated_by | UUID FK → users | |
| updated_at | TIMESTAMPTZ | |
| effective_date | DATE | Settings active from this date |

#### `cashier_time_windows`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID FK | |
| day_of_week | SMALLINT | 0=Sun … 6=Sat; NULL = applies to all days |
| window_open | TIME | |
| window_close | TIME | |
| is_active | BOOLEAN | |

#### `sales_logs`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| writer_id | UUID FK → writers | |
| game_type | VARCHAR(50) | |
| ticket_amount | DECIMAL(12,2) | |
| sale_date | DATE | |
| image_url | TEXT | Object storage URL |
| logged_by | UUID FK → users | agent's user id |
| created_at | TIMESTAMPTZ | |

#### `gross_entries`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| writer_id | UUID FK → writers | |
| entry_date | DATE | |
| gross_amount | DECIMAL(12,2) | |
| entered_by | UUID FK → users | |
| locked | BOOLEAN | Set after daily cut-off |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `wins_entries`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| writer_id | UUID FK → writers | |
| entry_date | DATE | |
| wins_amount | DECIMAL(12,2) | |
| entered_by | UUID FK → users | |
| locked | BOOLEAN | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `daily_calculations`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| writer_id | UUID FK → writers | |
| calc_date | DATE | |
| gross_sales | DECIMAL(12,2) | |
| commission_pct | DECIMAL(5,4) | Snapshot of setting at calc time |
| commission_amount | DECIMAL(12,2) | |
| net_gross | DECIMAL(12,2) | |
| wins_amount | DECIMAL(12,2) | |
| reserve_pct | DECIMAL(5,4) | Snapshot |
| reserve_amount | DECIMAL(12,2) | |
| writer_balance | DECIMAL(12,2) | |
| calculated_at | TIMESTAMPTZ | |

#### `payments`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_id | UUID FK → agents | |
| cashier_id | UUID FK → users | |
| amount | DECIMAL(12,2) | |
| payment_date | DATE | |
| notes | TEXT | |
| is_voided | BOOLEAN | |
| voided_by | UUID FK → users | |
| created_at | TIMESTAMPTZ | |

#### `reserve_fund`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID FK | |
| period_date | DATE | |
| total_contributed | DECIMAL(12,2) | Sum of reserve_amount for the period |
| total_allocated | DECIMAL(12,2) | Sum of allocations drawn |
| balance | DECIMAL(12,2) | Computed: contributed − allocated |

#### `reserve_allocations`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| writer_id | UUID FK → writers | |
| allocation_date | DATE | |
| amount_drawn | DECIMAL(12,2) | |
| reason | TEXT | |
| reserve_balance_after | DECIMAL(12,2) | |
| created_at | TIMESTAMPTZ | |

#### `notifications`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID FK | |
| sent_by | UUID FK → users | |
| message_type | ENUM | `announcement`, `alert`, `reminder` |
| title | VARCHAR(200) | |
| body | TEXT | |
| target_type | ENUM | `all`, `all_agents`, `agent`, `writer` |
| target_id | UUID | Agent or writer UUID if targeted |
| created_at | TIMESTAMPTZ | |

#### `notification_receipts`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| notification_id | UUID FK | |
| user_id | UUID FK | |
| read_at | TIMESTAMPTZ | NULL = unread |

---

## 6. API Surface (REST)

All endpoints are prefixed with `/api/v1`.

### 6.1 Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns access + refresh tokens |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Invalidate session |

### 6.2 Users & Agents
| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/users` | Admin | List all users |
| POST | `/users` | Admin | Create user |
| PATCH | `/users/:id` | Admin | Update user |
| DELETE | `/users/:id` | Admin | Deactivate user |
| GET | `/agents` | Admin, Director | List all agents |
| POST | `/agents` | Admin | Create agent + assign code |
| GET | `/agents/:id` | Admin, Director, Agent(self) | Agent detail |
| GET | `/agents/:id/writers` | Admin, Director, Agent(self) | List writers under agent |
| POST | `/agents/:id/writers` | Admin | Create writer + assign code |

### 6.3 Settings
| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/settings` | Admin, Director | Current system settings |
| POST | `/settings` | Admin | Create new settings record (effective from date) |
| GET | `/settings/time-windows` | Admin, Cashier | List cashier time windows |
| POST | `/settings/time-windows` | Admin | Create time window |
| PATCH | `/settings/time-windows/:id` | Admin | Update time window |
| DELETE | `/settings/time-windows/:id` | Admin | Remove time window |

### 6.4 Sales
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/sales` | Agent | Log a sale |
| GET | `/sales` | Agent(self), Admin | List sales (filterable) |
| POST | `/sales/:id/image` | Agent | Upload ticket image |

### 6.5 Gross & Wins Entry
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/entries/gross` | Gross Entry | Submit gross entry |
| PUT | `/entries/gross/:id` | Gross Entry | Update (if unlocked) |
| POST | `/entries/wins` | Wins Entry | Submit wins entry |
| PUT | `/entries/wins/:id` | Wins Entry | Update (if unlocked) |
| GET | `/entries` | Admin, Director | List entries by date/writer |

### 6.6 Payments
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/payments` | Cashier | Record payment |
| GET | `/payments` | Admin, Director, Cashier | List payments |
| POST | `/payments/:id/void` | Admin | Void a payment |

### 6.7 Calculations & Reports
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/calculations/run` | Admin | Trigger daily calculation batch |
| GET | `/calculations` | Admin, Director | List calculations |
| GET | `/reports/writer/:writerId` | Admin, Director, Agent(own) | Writer performance report |
| GET | `/reports/agent/:agentId` | Admin, Director, Agent(self) | Agent summary |
| GET | `/reports/organization` | Admin, Director | Org-wide summary |
| GET | `/reports/reserve` | Admin, Director | Reserve fund report |

### 6.8 Reserve Fund
| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/reserve/balance` | Admin, Director | Current reserve balance |
| GET | `/reserve/allocations` | Admin, Director | Allocation history |

### 6.9 Notifications
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/notifications` | Admin | Send notification |
| GET | `/notifications` | All | Inbox for current user |
| PATCH | `/notifications/:id/read` | All | Mark as read |
| GET | `/notifications/sent` | Admin, Director | Sent messages log |

---

## 7. Technology Stack

### 7.1 Backend
| Concern | Technology |
|---|---|
| Runtime | Node.js 24 (TypeScript) |
| API Framework | Express 5 |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 |
| Validation | Zod v4 + drizzle-zod |
| Auth | JWT (access + refresh), bcrypt for password hashing |
| File Storage | Object storage (S3-compatible) for ticket images |
| Job Scheduler | pg-boss (DB-backed job queue) for daily calculation runs and lock triggers |
| API Contract | OpenAPI 3.1 spec → Orval codegen for client hooks |
| Build | esbuild (CJS bundle) |

### 7.2 Web Frontend (PC / Tablet Roles)
| Concern | Technology |
|---|---|
| Framework | React 18 + Vite |
| State / Data | TanStack Query (React Query) |
| Routing | React Router v6 |
| UI Components | shadcn/ui + Tailwind CSS |
| Tables | TanStack Table |
| Forms | React Hook Form + Zod |
| Charts | Recharts (for Director/Admin dashboards) |
| Export | jsPDF + PapaParse (CSV) |

### 7.3 Mobile Frontend (Agent Role)
| Concern | Technology |
|---|---|
| Framework | Expo (React Native) |
| Navigation | Expo Router |
| Data / Auth | TanStack Query + custom fetch |
| Offline | AsyncStorage + sync-on-reconnect queue |
| Image Upload | expo-image-picker + multipart upload to API |
| Push Notifications | Expo Notifications + FCM/APNs |

---

## 8. Architecture

### 8.1 High-Level Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Clients                             │
│  ┌──────────────┐   ┌───────────────────────────────┐   │
│  │  Mobile App  │   │       Web App (Browser)       │   │
│  │  (Agents)    │   │  (Cashier / Entry / Admin /   │   │
│  │  Expo/RN     │   │   Director)                   │   │
│  └──────┬───────┘   └──────────────┬────────────────┘   │
└─────────┼─────────────────────────┼────────────────────┘
          │  HTTPS / REST + JWT      │
┌─────────▼─────────────────────────▼────────────────────┐
│                    API Server                           │
│               Express 5 / Node.js 24                   │
│  Auth │ Users │ Sales │ Entries │ Payments │ Reports    │
│  Notifications │ Reserve │ Calculations │ Settings      │
└───────────────────────┬─────────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │                            │
┌─────────▼─────────┐      ┌──────────▼──────────┐
│    PostgreSQL      │      │   Object Storage     │
│  (Drizzle ORM)     │      │ (Ticket Images)      │
└────────────────────┘      └─────────────────────┘
          │
┌─────────▼──────────┐
│   pg-boss (Jobs)   │
│ - Daily calc run   │
│ - Entry lock       │
│ - Notification     │
│   dispatch         │
└────────────────────┘
```

### 8.2 Calculation Processing

Daily calculations run as a scheduled background job (configurable time, e.g., 23:00 daily):

1. For each writer with a gross entry on the target date:
   - Fetch the `system_settings` effective on that date (snapshot for audit trail).
   - Compute commission, net gross, reserve deduction, writer balance.
   - Write result to `daily_calculations`.
2. Lock corresponding gross/wins entry records.
3. Roll up agent-level totals.
4. Append to `reserve_fund` period record.
5. Run smart allocation check: flag any writer with `writer_balance < 0`, attempt reserve fund draw.
6. Notify Administrator of any allocation events or insufficient-fund flags.

### 8.3 Cashier Time Window Enforcement

- The API middleware for `POST /payments` checks the current server time against active `cashier_time_windows`.
- If outside all active windows, the request is rejected with HTTP `403 FORBIDDEN` and a structured error message indicating the next open window.
- Administrator bypass flag available for emergency manual overrides (logged with reason).

### 8.4 Security Controls

| Control | Implementation |
|---|---|
| Authentication | JWT (RS256), 15-min access tokens, 7-day rotating refresh tokens |
| Authorization | Role-based middleware on every route |
| Data isolation | All queries scoped to `organization_id` from token claims |
| Audit trail | `created_by` / `updated_by` on all mutable records |
| Payment void | Requires Administrator role + mandatory reason text |
| Entry locking | Server-side, enforced after cut-off time by job scheduler |
| Image storage | Signed URLs with expiry; not publicly guessable |
| Input validation | Zod schemas on all request bodies and query params |

---

## 9. Offline Support (Mobile / Agent)

- Sales and image metadata queued locally using AsyncStorage when offline.
- On reconnect, sync queue processes in order: create sales records → upload images → attach URLs.
- Conflict resolution: server timestamp wins; duplicate detection by `(writer_id, sale_date, ticket_amount, game_type, image_hash)`.
- Agent sees sync status indicator in mobile UI (synced / pending / error).

---

## 10. Reporting & Export

| Report | Audience | Grouping | Export |
|---|---|---|---|
| Writer Daily Breakdown | Admin, Director, Agent(self) | Per writer per day | PDF, CSV |
| Agent Summary | Admin, Director, Agent(self) | All writers under agent, period total | PDF, CSV |
| Organization Overview | Director, Admin | All agents side-by-side | PDF, CSV |
| Reserve Fund Statement | Director, Admin | Period totals, allocations | PDF, CSV |
| Notification Log | Admin, Director | Sent messages + read receipts | CSV |
| Payment History | Admin, Director, Cashier | Per agent, date-filtered | PDF, CSV |

---

## 11. Phased Delivery

### Phase 1 — Core Platform (Foundation)
- User management, authentication, role enforcement
- Agent/writer code assignment
- System settings (commission %, reserve %)
- Gross entry, wins entry with time locking
- Daily calculation engine
- Basic writer and agent reports

### Phase 2 — Financial Operations
- Payment collection with cashier time windows
- Reserve fund tracking and smart allocation
- Reserve fund reports
- Director dashboard

### Phase 3 — Mobile & Communications
- Agent mobile app (Expo) — sales logging, image upload, offline sync
- Notification system — in-app + push
- PDF/CSV export for all reports

### Phase 4 — Polish & Admin Tools
- Bulk CSV import for gross/wins entries
- Audit log viewer for Administrator
- Emergency payment override flow
- Performance optimization and analytics

---

## 12. Open Questions for Stakeholders

1. **Calculation schedule:** Should daily calculations run automatically at a fixed cut-off time, or triggered manually by the Administrator?
2. **Multiple organizations:** Is this a single-tenant deployment per organization, or multi-tenant (multiple lottery organizations on one instance)?
3. **Game types:** Is there a fixed list of game types, or do administrators define them dynamically?
4. **Commission tiers:** Is commission percentage uniform across all agents, or can it be set per-agent or per-writer?
5. **Reserve allocation priority:** When multiple agents have pending shortfalls simultaneously, what is the allocation priority order (FIFO, largest shortfall first, etc.)?
6. **Cashier window exceptions:** Can a cashier request a one-time extension, or only an Administrator can override?
7. **Mobile platform targets:** iOS only, Android only, or both?
8. **Data retention:** How long should historical calculation and payment records be retained?
