# Stockroom Inventory

Stockroom Inventory is a web app for managing products, stock levels, sales, and inventory analytics. It includes user accounts, subscription billing, notifications, forecasting, and an AI-assisted chat interface.

## Features

- User registration, login, and password reset
- Product and category management, including stock adjustments
- Sales recording and sales summaries
- Low-stock notifications
- Forecasting and inventory analytics
- Subscription billing through Safepay
- Light and dark themes

## Tech stack

- Frontend: React 18 and Vite
- Backend: Node.js and Express
- Database: SQLite, accessed with Prisma

## Requirements

- Node.js 22.5 or newer
- npm
- A SQLite database with the schema expected by the Prisma migrations

## Local development

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/imtiazahmad18/Stockroom-inventory.git
   cd Stockroom-inventory
   npm install --prefix backend
   npm install --prefix frontend
   ```

2. Create the backend environment file and configure its required values:

   ```sh
   cp backend/.env.example backend/.env
   ```

   Set `DATABASE_URL` to your SQLite database, for example `file:./inventory.db`, and replace `JWT_SECRET` with a long, random secret. The other values in the example file configure optional email and Safepay integration.

3. Prepare the SQLite database. The migrations in this repository upgrade the app's existing database schema; they are not a baseline migration for a brand-new empty database. For an existing database, back it up first, then run:

   ```sh
   cd backend
   npx prisma migrate deploy
   cd ..
   ```

4. Start the API and frontend together:

   ```sh
   ./run.sh
   ```

   Alternatively, run `node run.js`. The development app is available at <http://localhost:5173>, and the API health endpoint is <http://localhost:4000/api/health>. Press Ctrl+C to stop both services.

## Running services individually

In separate terminals, start the backend and frontend:

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm run dev
```

The Vite development server proxies `/api` requests to the backend on port 4000.

## Production build

Build the frontend with:

```sh
npm --prefix frontend run build
```

Start the API with:

```sh
npm --prefix backend start
```

Configure production environment variables and serve the built frontend through your chosen web server or hosting platform.

## Environment variables

`backend/.env.example` documents the supported settings:

- `DATABASE_URL` and `JWT_SECRET` are required by the backend.
- `SMTP_*` settings configure password-reset email delivery.
- `SAFEPAY_*` settings configure subscription checkout and webhooks.
- `APP_URL` is the public URL of the frontend used by billing.
- `NODE_ENV` and `BILLING_DEV_BYPASS` control the development-only billing bypass.

Keep `backend/.env` and all real credentials out of version control.
