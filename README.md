# teak-furniture-api

Central API for the teak furniture **production management system** — NestJS + Prisma + PostgreSQL.
App-owned domain model (no Trello dependency): `Customer → Order → Product → ProductionTask →
WorkSession → TaskEvent(audit)`. Consumed by the React Native app (`teak-furniture-app`) and,
later, an admin web — over HTTP + JWT, documented at `/docs`.

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
| `0810000002` | WORKER | ขึ้นแบบ |
| `0810000003` | WORKER | รอของ |
| `0810000004` | WORKER | เก็บงาน |
| `0810000005` | WORKER | ทำสี |
| `0810000006` | WORKER | ส่ง |

## Run

```bash
npm run start:dev      # watch mode
# or: npm run build && npm run start:prod
```

- API base: `http://localhost:4000/api`
- Swagger UI: `http://localhost:4000/docs` (OpenAPI JSON at `/docs-json`)

## Key endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | phone + password → `{ accessToken, user }` |
| GET | `/me` | current user |
| GET | `/tasks/my` | role-aware "My Work" (worker sees own station) |
| GET | `/tasks` | filter: `?stage=&urgent=&delayed=&assigneeId=` |
| GET | `/tasks/board` | kanban buckets by stage |
| GET | `/tasks/:id` | detail: product, images, tags, timeline, running session |
| POST | `/tasks/:id/timer/start` · `/timer/stop` | one WorkSession per press |
| PATCH | `/tasks/:id/complete-stage` | close session + advance stage + audit |
| GET | `/tasks/:id/history` | TaskEvent audit trail |
| GET/POST | `/orders`, `/orders/:id`, `/orders/:id/products` | product create → auto Task |

All routes except `/auth/login` require `Authorization: Bearer <token>`.

## Schema

`prisma/schema.prisma`. Data-driven `WorkflowStage` (ขึ้นแบบ→รอของ→เก็บงาน→ทำสี→ส่ง→ส่งสำเร็จ);
every status change and timer press writes a `TaskEvent`; `WorkSession` stores one row per
start/stop. Regenerate the client after schema edits: `npx prisma generate`.

## Notes

- Dev uses the Postgres superuser in `.env` for convenience — create a dedicated least-privilege
  role for production.
- Image uploads are out of scope for Phase 1; `ImageAsset` stores URLs (seed uses picsum).
