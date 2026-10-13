-- Migration: add users + owner_id, backfill all existing rows to admin (option a)
-- Non-destructive: existing data is copied into rebuilt tables with owner_id = 1.

-- 1) Users table
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')'
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- 2) Seed the default admin (password: admin1234, real bcrypt hash)
INSERT INTO "users" ("id", "email", "password_hash", "role")
VALUES (1, 'admin@local', '$2b$10$VizR5Y4uqsqUaZ7MuxGMeOkEILblOamZ1CQATfyBXvow5mEBmd4ny', 'admin');

-- 3) Rebuild categories with owner_id, backfilled to admin
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL UNIQUE,
    "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
    "owner_id" INTEGER NOT NULL,
    CONSTRAINT "categories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_categories" ("id", "name", "created_at", "owner_id")
SELECT "id", "name", "created_at", 1 FROM "categories";
DROP TABLE "categories";
ALTER TABLE "new_categories" RENAME TO "categories";

-- 4) Rebuild products with owner_id, backfilled to admin
CREATE TABLE "new_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "category_id" INTEGER,
    "cost_price" REAL NOT NULL DEFAULT 0,
    "sale_price" REAL NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 5,
    "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
    "updated_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
    "owner_id" INTEGER NOT NULL,
    CONSTRAINT "products_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
INSERT INTO "new_products" ("id", "sku", "name", "category_id", "cost_price", "sale_price", "current_stock", "reorder_level", "created_at", "updated_at", "owner_id")
SELECT "id", "sku", "name", "category_id", "cost_price", "sale_price", "current_stock", "reorder_level", "created_at", "updated_at", 1 FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE INDEX "idx_products_category" ON "products"("category_id");

-- 5) Rebuild sales with owner_id, backfilled to admin
CREATE TABLE "new_sales" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sale_price" REAL NOT NULL,
    "cost_price_at_sale" REAL NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
    "owner_id" INTEGER NOT NULL,
    CONSTRAINT "sales_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
INSERT INTO "new_sales" ("id", "product_id", "quantity", "sale_price", "cost_price_at_sale", "created_at", "owner_id")
SELECT "id", "product_id", "quantity", "sale_price", "cost_price_at_sale", "created_at", 1 FROM "sales";
DROP TABLE "sales";
ALTER TABLE "new_sales" RENAME TO "sales";
CREATE INDEX "idx_sales_product" ON "sales"("product_id");

-- 6) Rebuild notifications with owner_id, backfilled to admin
CREATE TABLE "new_notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "product_id" INTEGER,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
    "owner_id" INTEGER NOT NULL,
    CONSTRAINT "notifications_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
INSERT INTO "new_notifications" ("id", "product_id", "type", "message", "is_read", "created_at", "owner_id")
SELECT "id", "product_id", "type", "message", "is_read", "created_at", 1 FROM "notifications";
DROP TABLE "notifications";
ALTER TABLE "new_notifications" RENAME TO "notifications";
CREATE INDEX "idx_notifications_unread" ON "notifications"("is_read");

-- 7) stock_logs keeps its shape (no owner column); recreate its index
CREATE INDEX IF NOT EXISTS "idx_stock_logs_product" ON "stock_logs"("product_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
