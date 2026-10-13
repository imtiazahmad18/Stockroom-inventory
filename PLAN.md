# Implementation Plan — User Signup/Registration + ORM Migration

## Baseline (actual repo)
- Backend: Node.js + Express (`backend/server.js`, port 4000, `/api/health`).
- DB: `node:sqlite` `DatabaseSync`, raw SQL via `db.prepare(...)`.
- Schema (`db.js`): categories, products (FK category_id), stock_logs (FK product_id),
  sales (FK product_id), notifications (FK product_id).
- Routes: products, categories, sales, analytics, notifications, chat.
  Services: stockService, forecastService, analyticsService, chatTools, backgroundAgent.
- No auth/user code. Frontend: React + Vite, `api.js` base `/api`, `App.jsx` view-switching.

## Confirmed decisions
1. Existing rows -> assigned to ONE default admin user (option a, non-destructive).
2. ORM -> Prisma.

## Goal
1. Secure user signup / registration.
2. Protect it: authenticate; each user accesses only their own data.
3. Enforce on frontend and backend.
4. Replace raw SQL with Prisma.

## Target architecture
```
backend/
  prisma/schema.prisma      # User + Category, Product, StockLog, Sale, Notification (+ownerId)
  lib/prisma.js             # Prisma client singleton
  auth.js                   # bcrypt hashing + JWT sign/verify
  middleware/auth.js        # requireAuth -> req.user (401 otherwise)
  routes/auth.js            # POST /api/auth/register, /api/auth/login
  routes/*.js               # rewritten to Prisma, scoped by req.user.id
frontend/src/
  context/AuthContext.jsx   # token + user
  pages/Signup.jsx, Login.jsx
  api.js                    # Authorization header + auth calls
  components/*              # guarded, own-data only
```

## Security
- bcrypt hashing; JWT signed with `JWT_SECRET` from env.
- requireAuth: 401 on missing/invalid token.
- Ownership: 404 (not 403) for foreign rows.
- Validate email format + password length (>= 8).

## ORM mandate
- All DB access via Prisma. No `db.prepare(...)`, no built SQL strings.
- Final audit greps to prove zero raw SQL remains.

## Tasks (DONE only after its test passes)
- P1. Confirm boot + /api/health = 200.
- P2. Add Prisma, introspect schema, generate client.
- P3. Add User + ownerId; migration backfills all rows to default admin.
- P4. Auth module: bcrypt + JWT + env secret.
- P5. Auth routes register + login (201/200/409/401).
- P6. requireAuth middleware on protected routes (401 without token).
- P7. Migrate all raw SQL (routes + services) to Prisma.
- P8. Owner scoping on data routes/services; cross-user isolation.
- P9. Frontend AuthContext + Login + Signup.
- P10. Frontend guarded views, own-data only, logout.
- P11. ORM audit: grep backend raw SQL -> empty.
- P12. End-to-end test.
