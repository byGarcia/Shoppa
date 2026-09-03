-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_ATTEMPT', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'RATE_LIMITED', 'INVALID_ORIGIN', 'SUSPICIOUS_REQUEST', 'SESSION_EXPIRED', 'API_ERROR', 'PASSKEY_REGISTERED', 'PASSKEY_DELETED');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "GroceryItemSource" AS ENUM ('APP', 'SIRI');

-- CreateEnum
CREATE TYPE "HintOrigin" AS ENUM ('SEED', 'LEARNED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "image" TEXT,
    "email_verified" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[],
    "device_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_logs" (
    "id" TEXT NOT NULL,
    "event_type" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'INFO',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT,
    "email" TEXT,
    "endpoint" TEXT,
    "origin" TEXT,
    "details" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grocery_stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grocery_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grocery_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grocery_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grocery_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "store_id" TEXT,
    "category_id" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "source" "GroceryItemSource" NOT NULL DEFAULT 'APP',
    "added_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "grocery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_category_hints" (
    "id" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category_id" TEXT,
    "store_hint_id" TEXT,
    "origin" "HintOrigin" NOT NULL DEFAULT 'SEED',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_category_hints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "voice_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_products" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT,
    "base_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "current_price" DECIMAL(12,2),
    "lowest_price" DECIMAL(12,2),
    "lowest_at" TIMESTAMP(3),
    "price_hint_source" TEXT,
    "alert_active" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "fail_notified" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_checks" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "security_logs_event_type_created_at_idx" ON "security_logs"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "security_logs_ip_address_created_at_idx" ON "security_logs"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "security_logs_user_id_created_at_idx" ON "security_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_logs_severity_created_at_idx" ON "security_logs"("severity", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "grocery_stores_name_key" ON "grocery_stores"("name");

-- CreateIndex
CREATE UNIQUE INDEX "grocery_categories_name_key" ON "grocery_categories"("name");

-- CreateIndex
CREATE INDEX "grocery_items_store_id_checked_idx" ON "grocery_items"("store_id", "checked");

-- CreateIndex
CREATE INDEX "grocery_items_store_id_category_id_idx" ON "grocery_items"("store_id", "category_id");

-- CreateIndex
CREATE INDEX "grocery_items_checked_checked_at_idx" ON "grocery_items"("checked", "checked_at");

-- CreateIndex
CREATE INDEX "grocery_items_normalized_name_idx" ON "grocery_items"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "item_category_hints_normalized_name_key" ON "item_category_hints"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "voice_tokens_token_hash_key" ON "voice_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "voice_tokens_user_id_idx" ON "voice_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_products_url_key" ON "tracked_products"("url");

-- CreateIndex
CREATE INDEX "tracked_products_is_active_last_checked_at_idx" ON "tracked_products"("is_active", "last_checked_at");

-- CreateIndex
CREATE INDEX "price_checks_product_id_checked_at_idx" ON "price_checks"("product_id", "checked_at");

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "grocery_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "grocery_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_category_hints" ADD CONSTRAINT "item_category_hints_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "grocery_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_category_hints" ADD CONSTRAINT "item_category_hints_store_hint_id_fkey" FOREIGN KEY ("store_hint_id") REFERENCES "grocery_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_tokens" ADD CONSTRAINT "voice_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "tracked_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
