# Project memory — Inventory app (Imtiaz)

## Run / test
- Backend uses `node:sqlite` -> requires Node >= 22.5. Default `node` here is v20 (fails).
  Always: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`
- Backend: `cd backend && node server.js` (port 4000). Health: `curl localhost:4000/api/health`.
- DB file: `backend/inventory.db` (SQLite).

## Stack (verified on disk)
- Node.js + Express (ES modules). ORM = Prisma (stable v6); legacy raw SQL in `db.js` and
  some `routes/*` is being migrated (see TASKS.md P7/P8).
- Tables: categories, products (FK category_id), stock_logs (FK product_id),
  sales (FK product_id), notifications (FK product_id).
- Frontend: React + Vite, `api.js` base `/api`, `App.jsx` view switching. No auth yet.

## Confirmed decisions
- ORM = Prisma (stable v6.x). Existing rows -> one default admin user (option a).

## Prisma (installed stable v6)
- prisma 6.19.3 + @prisma/client 6.19.3 installed. Schema: `backend/prisma/schema.prisma`
  (generator prisma-client-js, 6 models incl. users).
- `DATABASE_URL="file:../inventory.db"` in backend/.env (relative to prisma/ dir).
- Do NOT run `migrate dev` on this DB (it wants to reset). `migrate status` = up to date.
- Import client via `backend/lib/prisma.js` (default export).

## Auth (implemented)
- `backend/auth.js`: bcrypt hash/verify + JWT sign. `backend/middleware/auth.js`: requireAuth.
- `backend/routes/auth.js`: POST /api/auth/register (201/409), POST /api/auth/login (200/401).
- server.js mounts /api/auth and guards products, categories, sales, notifications, chat, analytics.
- Seeded admin: admin@example.com / admin1234 (id=1). Test user: p5user@example.com (id=2).
  (Old `admin@local` was rejected by the login EMAIL_RE — no dot after @ — so the
  admin row's email was changed to admin@example.com.)
- Raw SQL fully migrated to Prisma (P7/P8/P11 DONE). `backend/db.js` deleted.
  seed.js is Prisma now: `node seed.js <ownerId>`.
- Background agent (`backgroundAgent.js`) loops over all users and owner-scopes
  notification dedupe/inserts.

## Gotcha: Prisma model names & fields in chatTools.js / agent.js
- Prisma models are PLURAL: `prisma.products`, `prisma.sales`, `prisma.notifications`, `prisma.users`.
  (Old code used singular `prisma.product` / `prisma.sale` / `prisma.notification` -> threw.)
- Prisma fields are snake_case: `owner_id`, `current_stock`, `reorder_level`, `sale_price`,
  `cost_price`, `cost_price_at_sale`, `category_id`, `product_id`. Relation is `categories`
  (not `category`). Never write camelCase (`ownerId`, `currentStock`, `salePrice`, `category`).
- `chatTools.js` had a hypothetical camelCase schema; fixed. `applyStockChange` (stockService.js)
  and routes already use snake_case.

## Gotcha: agent.js grounding rules
- `GROUNDING_RULES` maps read-only questions to a tool fetched up front. Added a rule for
  list/inventory questions -> `list_products`, and `itemsFromGroundingResult` maps list_products rows.
- ORDER MATTERS (first match wins): keep the generic `list_products` rule LAST, after
  low-stock / insights / forecast / sales rules. Otherwise "show my top selling products"
  matches the list rule and the sales/insights tool is skipped.
- If the model returns parseable JSON that is neither a tool_call nor a final answer
  (e.g. {"products":[...]}), agent.js now gives a corrective nudge instead of the generic failure.
- `MAX_STEPS = 10` (was 5) so a turn can chain more tool calls.

## Chat session persistence (ChatWidget)
- Conversation is saved to localStorage key `stockroom-chat` (survives refresh; the widget
  stays mounted while the chat panel is open/closed).
- `AuthContext.logout()` and the 401 `auth:unauthorized` handler both clear `stockroom-chat`,
  so a new user never inherits the previous session's history.
- History is sent to the backend as `history` and rendered by `formatHistory` (last 10 turns).

## Gotcha: regex literals via FILE tools
- Writing a regex with `\\s` through FILE tools can land as **doubled** backslashes,
  making the class exclude `\\` and `s`. After writing a regex, verify:
  `sed -n 'Np' file | cat -A` -> must show a single `\\s`.

## Frontend auth (P9/P10 done)
- `frontend/src/AuthContext.jsx` — AuthProvider + useAuth; token in
  localStorage `stockroom-token`, cached user in `stockroom-user`.
  Any 401 triggers `auth:unauthorized` -> auto logout.
- `frontend/src/api.js` — getToken/setToken, adds `Authorization: Bearer`,
  exports `api.login`/`api.register`.
- `frontend/src/components/Login.jsx`, `Signup.jsx`; `main.jsx` wraps App in
  AuthProvider; `App.jsx` gates views; `Sidebar.jsx` shows user + logout.
- Verify: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH && cd frontend && npm run build`.

## Status discipline
- A task is DONE only after its test passes AND the file exists on disk (verify with ls/cat).
- Earlier session falsely marked P2-P4 done; TASKS.md now reflects reality.
