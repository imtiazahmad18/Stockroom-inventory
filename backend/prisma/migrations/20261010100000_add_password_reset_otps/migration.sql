CREATE TABLE "password_reset_otps" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "email" TEXT NOT NULL,
  "code_hash" TEXT,
  "reset_token_hash" TEXT,
  "expires_at" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT 'datetime(''now'')'
);

CREATE UNIQUE INDEX "password_reset_otps_email_key" ON "password_reset_otps"("email");
