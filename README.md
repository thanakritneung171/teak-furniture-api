# teak-furniture-api

Central API for the teak furniture **production management system** — NestJS + Prisma + PostgreSQL.
App-owned domain model (no Trello dependency): `Customer → Order → Product → ProductionTask →
WorkSession → TaskEvent(audit)`, with data-driven `WorkflowStage`, per-user `Notification`, and
`ImageAsset`. Consumed by the React Native app (`teak-furniture-app`) and, later, an admin web —
over HTTP + JWT, documented at `/docs`.

Remaining/future work: see [`ROADMAP.md`](./ROADMAP.md) (FCM push, admin web, reports).

## Requirements

- Node 18+ and PostgreSQL (local dev uses the Postgres instance on this machine).

## Setup

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL + JWT_SECRET
npx prisma migrate dev      # creates the teak_production DB + tables + runs the seed
```

Seed creates the 6 workflow stages, an admin, a supervisor, one worker per stage, and a sample
order with tasks spread across stages (incl. urgent + overdue).

**Login accounts** (all password `password`):

| phone | role | station |
|---|---|---|
| `0810000000` | ADMIN | — |
| `0810000001` | SUPERVISOR | — |
| `0810000002`–`0810000006` | WORKER | ขึ้นแบบ / รอของ / เก็บงาน / ทำสี / ส่ง |

## Run

```bash
npm run start:dev      # watch mode
# or: npm run build && npm run start:prod
```

- API base: `http://localhost:4000/api`
- Static uploads: `http://localhost:4000/uploads/<file>`
- Swagger UI: `http://localhost:4000/docs` (OpenAPI JSON at `/docs-json`)

## Endpoints

**Auth / users**
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | phone + password → `{ accessToken, user }` |
| GET | `/me` | current user |
| GET | `/users` | list (admin/supervisor) — for assignment |
| POST | `/users` | create employee (admin) — role/station |

**Orders / products**
| Method | Path | Notes |
|---|---|---|
| GET | `/orders`, `/orders/:id` | list / detail (products + tasks) |
| POST | `/orders` | create order (admin/supervisor) |
| POST | `/orders/:id/products` | add product → **auto-creates a ProductionTask** |

**Tasks / workflow**
| Method | Path | Notes |
|---|---|---|
| GET | `/tasks/my` | role-aware "My Work" (worker sees own station) |
| GET | `/tasks` | filter: `?stage=&urgent=&delayed=&assigneeId=` |
| GET | `/tasks/board` | kanban buckets by stage |
| GET | `/tasks/:id` · `/tasks/:id/history` | detail (images, tags, timeline) · audit trail |
| POST | `/tasks/:id/timer/start` · `/timer/stop` | one WorkSession per press |
| PATCH | `/tasks/:id/complete-stage` | close session + advance stage + audit |
| PATCH | `/tasks/:id/assign` | assign to a worker (+ notification) |

**Meta / notifications / uploads**
| Method | Path | Notes |
|---|---|---|
| GET | `/stages` | workflow stages |
| GET | `/overview` | KPI (total, in-production, delayed, unassigned, by-stage) |
| GET | `/notifications` | computed alerts (overdue, urgent-unassigned) |
| GET | `/inbox` · PATCH `/inbox/:id/read` · POST `/inbox/read-all` | persisted per-user inbox |
| POST | `/uploads` | multipart file → `{ url }` (saved to `uploads/`, served at `/uploads`) |
| POST | `/images` | attach an ImageAsset to order/product/task |

All routes except `/auth/login` require `Authorization: Bearer <token>`.

## Schema

`prisma/schema.prisma`. Data-driven `WorkflowStage` (ขึ้นแบบ→รอของ→เก็บงาน→ทำสี→ส่ง→ส่งสำเร็จ);
every status change and timer press writes a `TaskEvent`; `WorkSession` = one row per start/stop;
`Notification` is persisted per-user (created on assignment). Regenerate the client after schema
edits: `npx prisma generate`.

## Notes

- Dev uses the Postgres superuser in `.env`; create a dedicated least-privilege role for production.
- Uploaded files live in `uploads/` (gitignored). For production, move to object storage (S3/R2).
- Notifications are persisted + in-app; OS push (FCM) is planned — see `ROADMAP.md`.
