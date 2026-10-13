CREATE TABLE "billing_subscriptions" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "provider_subscription_id" TEXT,
  "checkout_reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "current_period_end" TEXT,
  "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
  "updated_at" TEXT NOT NULL DEFAULT 'datetime(''now'')',
  CONSTRAINT "billing_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "billing_subscriptions_provider_subscription_id_key" ON "billing_subscriptions"("provider_subscription_id");
CREATE UNIQUE INDEX "billing_subscriptions_checkout_reference_key" ON "billing_subscriptions"("checkout_reference");
CREATE INDEX "billing_subscriptions_user_id_created_at_idx" ON "billing_subscriptions"("user_id", "created_at");

CREATE TABLE "billing_webhook_events" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "received_at" TEXT NOT NULL DEFAULT 'datetime(''now'')'
);
CREATE UNIQUE INDEX "billing_webhook_events_event_id_key" ON "billing_webhook_events"("event_id");
