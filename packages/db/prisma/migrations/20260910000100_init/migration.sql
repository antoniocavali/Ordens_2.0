-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('PLATFORM', 'MATRIZ', 'FARM', 'BUYER', 'CARRIER');

-- CreateEnum
CREATE TYPE "org_kind" AS ENUM ('MATRIZ', 'FARM', 'BUYER', 'CARRIER');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "session_stage" AS ENUM ('PENDING_2FA', 'PENDING_2FA_SETUP', 'ACTIVE');

-- CreateEnum
CREATE TYPE "login_result" AS ENUM ('SUCCESS', 'INVALID_CREDENTIALS', 'LOCKED', 'TWO_FACTOR_FAILED', 'TWO_FACTOR_SUCCESS', 'INACTIVE');

-- CreateEnum
CREATE TYPE "partner_role" AS ENUM ('BUYER', 'SELLER', 'PRODUCER', 'COOPERATIVE_MEMBER', 'COOPERATIVE', 'CARRIER', 'OTHER');

-- CreateEnum
CREATE TYPE "person_type" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "freight_mode" AS ENUM ('CIF', 'FOB', 'THIRD_PARTY', 'TO_DEFINE');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "order_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "operation_type" AS ENUM ('PURCHASE', 'SALE', 'TRANSFER', 'STORAGE');

-- CreateEnum
CREATE TYPE "release_status" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "upload_status" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'AVAILABLE', 'REJECTED', 'INFECTED', 'ABORTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "scan_status" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR', 'SKIPPED_DEV');

-- CreateEnum
CREATE TYPE "document_kind" AS ENUM ('NFE_XML', 'PDF', 'IMAGE', 'SPREADSHEET', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "require_2fa" BOOLEAN NOT NULL DEFAULT false,
    "require_2fa_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "view_sla_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "org_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "partner_id" UUID,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "security_version" INTEGER NOT NULL DEFAULT 1,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" "scope_type" NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "scope_type" NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_code" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_code","permission_code")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "membership_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_code")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "active_membership_id" UUID,
    "security_version" INTEGER NOT NULL,
    "stage" "session_stage" NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "result" "login_result" NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "secret_enc" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_time_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "sign_count" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "sidebar_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "actor_membership_id" UUID,
    "actor_role" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "session_id" UUID,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "kind" "document_kind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "declared_mime" TEXT NOT NULL,
    "detected_mime" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "multipart_id" TEXT,
    "sha256_declared" TEXT,
    "sha256_actual" TEXT,
    "status" "upload_status" NOT NULL DEFAULT 'PENDING',
    "scan_status" "scan_status" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "person_type" "person_type" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "document" TEXT NOT NULL,
    "state_registration" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "zip_code" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "business_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_roles" (
    "partner_id" UUID NOT NULL,
    "role" "partner_role" NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "partner_roles_pkey" PRIMARY KEY ("partner_id","role")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_partner_id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "state_registration" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "zip_code" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "loading_point" TEXT,
    "operating_hours" JSONB,
    "daily_capacity" DECIMAL(18,4),
    "access_restrictions" TEXT,
    "carrier_instructions" TEXT,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factor_to_kg" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commodities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "default_unit_id" UUID,
    "description" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commodities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "seller_partner_id" UUID NOT NULL,
    "buyer_partner_id" UUID NOT NULL,
    "commodity_id" UUID NOT NULL,
    "crop_year" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID NOT NULL,
    "unit_price" DECIMAL(18,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "total_value" DECIMAL(18,2),
    "starts_on" DATE,
    "ends_on" DATE,
    "freight_mode" "freight_mode",
    "terms" TEXT,
    "notes" TEXT,
    "status" "contract_status" NOT NULL DEFAULT 'ACTIVE',
    "buyer_org_id" UUID,
    "seller_org_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","name","year")
);

-- CreateTable
CREATE TABLE "loading_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "external_number" TEXT,
    "order_date" DATE,
    "status" "order_status" NOT NULL DEFAULT 'DRAFT',
    "priority" "order_priority" NOT NULL DEFAULT 'NORMAL',
    "operation_type" "operation_type",
    "version" INTEGER NOT NULL DEFAULT 0,
    "contract_id" UUID,
    "seller_partner_id" UUID,
    "farm_id" UUID,
    "buyer_partner_id" UUID,
    "seller_org_id" UUID,
    "buyer_org_id" UUID,
    "commodity_id" UUID,
    "crop_year" TEXT,
    "quantity" DECIMAL(18,4),
    "unit_id" UUID,
    "released_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scheduled_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "loaded_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "in_transit_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelled_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "freight_mode" "freight_mode",
    "freight_estimate" DECIMAL(18,2),
    "preferred_carrier_id" UUID,
    "loading_starts_on" DATE,
    "loading_ends_on" DATE,
    "tolerance_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "destination_name" TEXT,
    "destination_address" TEXT,
    "destination_city" TEXT,
    "destination_state" CHAR(2),
    "commercial_terms" TEXT,
    "loading_instructions" TEXT,
    "internal_notes" TEXT,
    "farm_notes" TEXT,
    "buyer_notes" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "last_material_change_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "loading_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loading_order_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "material_snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loading_order_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loading_order_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "valid_until" DATE,
    "status" "release_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "order_version" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,

    CONSTRAINT "loading_order_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loading_order_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "side" "scope_type" NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "first_viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "view_count" INTEGER NOT NULL DEFAULT 1,
    "last_ip" INET,
    "last_user_agent" TEXT,
    "last_session_id" UUID,
    "correlation_id" TEXT,

    CONSTRAINT "loading_order_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_kind_idx" ON "organizations"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_partner_id_idx" ON "organizations"("tenant_id", "partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_organization_id_idx" ON "memberships"("tenant_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "membership_roles_tenant_id_idx" ON "membership_roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "login_attempts_user_id_created_at_idx" ON "login_attempts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_credentials_user_id_key" ON "two_factor_credentials"("user_id");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "saved_views_tenant_id_user_id_resource_idx" ON "saved_views"("tenant_id", "user_id", "resource");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_entity_type_entity_id_occurred_at_idx" ON "audit_events"("tenant_id", "entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "audit_events"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_uploads_object_key_key" ON "file_uploads"("object_key");

-- CreateIndex
CREATE INDEX "file_uploads_tenant_id_entity_type_entity_id_idx" ON "file_uploads"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "file_uploads_status_created_at_idx" ON "file_uploads"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_uploads_tenant_id_idempotency_key_key" ON "file_uploads"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_created_at_idx" ON "notifications"("tenant_id", "user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "business_partners_tenant_id_legal_name_idx" ON "business_partners"("tenant_id", "legal_name");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_tenant_id_document_key" ON "business_partners"("tenant_id", "document");

-- CreateIndex
CREATE INDEX "partner_roles_tenant_id_role_idx" ON "partner_roles"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "farms_tenant_id_owner_partner_id_idx" ON "farms"("tenant_id", "owner_partner_id");

-- CreateIndex
CREATE INDEX "farms_tenant_id_organization_id_idx" ON "farms"("tenant_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_code_key" ON "units"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "commodities_tenant_id_code_key" ON "commodities"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_seller_partner_id_idx" ON "contracts"("tenant_id", "seller_partner_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_buyer_partner_id_idx" ON "contracts"("tenant_id", "buyer_partner_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_commodity_id_idx" ON "contracts"("tenant_id", "commodity_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_number_key" ON "contracts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_status_loading_starts_on_idx" ON "loading_orders"("tenant_id", "status", "loading_starts_on");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_seller_partner_id_idx" ON "loading_orders"("tenant_id", "seller_partner_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_farm_id_idx" ON "loading_orders"("tenant_id", "farm_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_buyer_partner_id_idx" ON "loading_orders"("tenant_id", "buyer_partner_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_commodity_id_idx" ON "loading_orders"("tenant_id", "commodity_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_contract_id_idx" ON "loading_orders"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_seller_org_id_idx" ON "loading_orders"("tenant_id", "seller_org_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_buyer_org_id_idx" ON "loading_orders"("tenant_id", "buyer_org_id");

-- CreateIndex
CREATE INDEX "loading_orders_tenant_id_updated_at_idx" ON "loading_orders"("tenant_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "loading_orders_tenant_id_number_key" ON "loading_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "loading_order_versions_tenant_id_idx" ON "loading_order_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "loading_order_versions_order_id_version_key" ON "loading_order_versions"("order_id", "version");

-- CreateIndex
CREATE INDEX "loading_order_releases_tenant_id_idx" ON "loading_order_releases"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "loading_order_releases_order_id_sequence_key" ON "loading_order_releases"("order_id", "sequence");

-- CreateIndex
CREATE INDEX "loading_order_views_tenant_id_order_id_side_version_idx" ON "loading_order_views"("tenant_id", "order_id", "side", "version");

-- CreateIndex
CREATE UNIQUE INDEX "loading_order_views_order_id_organization_id_user_id_versio_key" ON "loading_order_views"("order_id", "organization_id", "user_id", "version");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_credentials" ADD CONSTRAINT "two_factor_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_roles" ADD CONSTRAINT "partner_roles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_owner_partner_id_fkey" FOREIGN KEY ("owner_partner_id") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loading_order_versions" ADD CONSTRAINT "loading_order_versions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "loading_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loading_order_releases" ADD CONSTRAINT "loading_order_releases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "loading_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loading_order_views" ADD CONSTRAINT "loading_order_views_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "loading_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
