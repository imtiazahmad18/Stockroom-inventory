# Tasks — Signup/Registration + Prisma Migration

Confirmed decisions: ORM = Prisma; existing rows -> default admin (option a).

## IMPORTANT: earlier P2–P4 were falsely marked DONE
On-disk audit (real): backend/prisma, backend/auth.js, backend/middleware/auth.js,
backend/routes/auth.js DO NOT EXIST. package.json has no Prisma. So P2, P3, P4 are
NOT implemented and are reopened below. Mark a task [x] ONLY after its test passes on disk.

## Environment note
- node:sqlite requires Node >= 22.5. System default `node` is v20 (fails to boot).
- Use Node 22.23.2: export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH

## Status
- [x] P1. Confirm boot + /api/health = 200. (verified with Node 22 -> health=200)
- [x] P2. Add Prisma, introspect schema, generate client.
  Verified: prisma 6.19.3 CLI+client installed; `db pull` introspected 5 models
  (categories, products, sales, stock_logs, notifications); `generate` OK; smoke test
  read counts from real DB: categories 5, products 5, sales 30, notifications 16, stock_logs 121.
  Note: DATABASE_URL="file:../inventory.db" (relative to prisma/ dir).
- [x] P3. Add User + ownerId; migration backfills all rows to default admin.
  Verified: users table + admin@local (id=1, role=admin, real bcrypt hash) seeded;
  backfill 5/5 categories, 5/5 products, 30/30 sales, 16/16 notifications owned by admin;
  stock_logs 121 intact; foreign_key_check empty; integrity_check ok; Prisma client reads
  all rows with owner_id=1. DB backup: inventory.db.bak-20260925-190252.
  Note: migration applied via direct SQL (migrate deploy refuses non-empty un-baselined DB),
  then recorded with `migrate resolve --applied`; `migrate status` = up to date.
- [x] P4. Auth module: bcrypt + JWT + env secret.
  Verified: backend/auth.js has hash/verify (bcrypt) + signToken (JWT); JWT round-trip OK;
  admin hash validates for admin1234; JWT_SECRET/JWT_EXPIRES_IN in backend/.env.
- [x] P5. Auth routes register + login (201/200/409/401).
  Verified live (Node 22, server on :4000): register new -> 201 {token,user};
  duplicate -> 409; login correct -> 200 {token,user}; login wrong -> 401.
  Fixed bug: EMAIL_RE had doubled backslashes in file (\\s) so all emails failed;
  rewrote as single \\s. Test user p5user@example.com (id=2) created.
- [x] P6. requireAuth middleware on protected routes (401 without token).
  Verified live: GET /api/products without token -> 401; with Bearer token -> 200.
  requireAuth guards products, categories, sales, notifications, chat, analytics.
- [x] P7. Migrate all raw SQL (routes + services) to Prisma.
  Migrated: categories, notifications, products, sales, analytics, forecast,
  stockService, chatTools, agent.js, backgroundAgent.js, routes/chat.js, seed.js.
  Typed Prisma CRUD; $queryRaw (owner-scoped) for analytics/forecast. runTool/
  getInventorySnapshot/resolveSingleProduct take ownerId; applyStockChange(tx,...)
  used inside prisma.$transaction. Verified live (Node 22): products/categories/
  sales/notifications/analytics/insights/chat with Bearer -> all 200.
- [x] P8. Owner scoping on data routes/services; cross-user isolation.
  All reads/writes filter by req.user.id. Verified: admin sees 5 products;
  second user sees 0 products, 0 sales.
- [x] P9. Frontend AuthContext + Login + Signup.
  frontend/src/AuthContext.jsx (token+user in localStorage, 401 -> logout),
  components/Login.jsx, components/Signup.jsx, api.js adds auth header +
  register/login. Verified: `npm run build` in frontend/ succeeds.
- [x] P10. Frontend guarded views, own-data only, logout.
  main.jsx wraps App in AuthProvider; App.jsx gates on user (shows Login/Signup),
  Sidebar.jsx shows user email + Log out. Backend already owner-scopes all data
  (P8), so each user sees only their own data.
- [x] P11. ORM audit: grep backend raw SQL -> empty.
  grep --exclude-dir=node_modules "db.prepare|node:sqlite|from './db.js'" backend/
  -> no matches. backend/db.js deleted; seed.js now Prisma (node seed.js <ownerId>).
- [ ] P12. End-to-end test.

## Notes
- server.js: authRouter mounted at /api/auth; requireAuth guards products, categories,
  sales, notifications, chat, analytics.
- Default admin seeded: admin@local / admin1234 (id=1).
- Reminder: mark a task DONE only after its test passes.
- Gotcha: regex literals written via FILE tools can land with doubled backslashes;
  verify with `sed -n 'Np' file | cat -A` that `\\s` is a single backslash.
