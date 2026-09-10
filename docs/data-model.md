# Modelo de Dados (ER)

Convenções:

- PK `uuid` (v7 gerado na aplicação quando ordenação temporal for útil; `gen_random_uuid()` como default).
- Toda tabela de negócio possui `tenant_id` (NOT NULL, FK) e é protegida por RLS.
- `created_at`, `updated_at`, `created_by`, `updated_by`; `archived_at`/`deleted_at` para soft delete. Sem DELETE físico em entidades de negócio.
- Quantidades `numeric(18,4)`; valores monetários `numeric(18,2)`; preços unitários `numeric(18,6)`. **Nunca float.**
- Status são `enum` PostgreSQL espelhados em `@ordens/contracts`.
- Nomes de tabelas em inglês `snake_case`; UI em português.

## Identidade, tenancy e segurança

```mermaid
erDiagram
  tenants ||--o{ organizations : possui
  tenants ||--o{ memberships : possui
  users ||--o{ memberships : "participa via"
  organizations ||--o{ memberships : agrupa
  memberships ||--o{ membership_roles : recebe
  roles ||--o{ membership_roles : ""
  roles ||--o{ role_permissions : ""
  permissions ||--o{ role_permissions : ""
  users ||--o{ sessions : ""
  users ||--o{ login_attempts : ""
  users ||--o| two_factor_credentials : ""
  users ||--o{ recovery_codes : ""
  users ||--o{ webauthn_credentials : "futuro"
  users ||--o{ password_reset_tokens : ""
  users ||--o| user_preferences : ""
  organizations }o--o| business_partners : "representa"

  tenants { uuid id PK; text slug UK; text name; tenant_status status; bool require_2fa; jsonb require_2fa_roles; int view_sla_hours }
  organizations { uuid id PK; uuid tenant_id FK; org_kind kind "MATRIZ|FARM|BUYER|CARRIER"; text name; uuid partner_id FK; status }
  users { uuid id PK; citext email UK; text name; text password_hash; int security_version; timestamptz locked_until; int failed_login_count; bool is_platform_admin; status }
  memberships { uuid id PK; uuid tenant_id FK; uuid user_id FK; uuid organization_id FK; scope_type scope; membership_status status }
  roles { uuid id PK; text code UK; scope_type scope; text name }
  permissions { text code PK; text description }
  sessions { uuid id PK; bytea token_hash UK; uuid user_id FK; uuid active_membership_id; int security_version; session_stage stage "PENDING_2FA|ACTIVE"; inet ip; text user_agent; timestamptz expires_at; timestamptz revoked_at }
  login_attempts { uuid id PK; uuid user_id; citext email; inet ip; text user_agent; login_result result; timestamptz created_at }
  two_factor_credentials { uuid id PK; uuid user_id UK; bytea secret_enc; bool confirmed; timestamptz confirmed_at }
  recovery_codes { uuid id PK; uuid user_id FK; text code_hash; timestamptz used_at }
```

**Justificativa**: `users` é identidade **global** (uma senha, um 2FA, um conjunto de sessões por pessoa); o acesso é concedido por `memberships` (tenant + organização + escopo) e papéis pertencem à membership ([ADR-001](decisions/ADR-001-identidade-global-membership.md)). A lista original citava `roles/permissions` ligados ao usuário — alterado.

## Parceiros e cadastros mestres

```mermaid
erDiagram
  business_partners ||--o{ partner_roles : desempenha
  business_partners ||--o{ partner_contacts : ""
  business_partners ||--o{ partner_addresses : ""
  business_partners ||--o{ farms : "possui (vendedor/produtor)"
  business_partners ||--o| carrier_profiles : "se transportadora"
  business_partners ||--o{ drivers : "transportadora"
  business_partners ||--o{ vehicles : "transportadora"
  commodities }o--|| units : "unidade padrão"

  business_partners { uuid id PK; uuid tenant_id; person_type person_type "PF|PJ"; text legal_name; text trade_name; text document "CPF/CNPJ normalizado"; text state_registration; status; text notes }
  partner_roles { uuid partner_id PK; partner_role role PK "BUYER|SELLER|PRODUCER|COOPERATIVE_MEMBER|COOPERATIVE|CARRIER|OTHER" }
  farms { uuid id PK; uuid tenant_id; uuid owner_partner_id FK; uuid organization_id FK "org da Fazenda"; text name; text code; text state_registration; text city; char2 state; text zip; numeric lat; numeric lng; text loading_point; jsonb operating_hours; numeric daily_capacity; text access_restrictions; text carrier_instructions; status }
  carrier_profiles { uuid partner_id PK; text rntrc; uuid ops_contact_id }
  drivers { uuid id PK; uuid tenant_id; uuid carrier_partner_id FK; text name; text cpf; text phone; text cnh_number; text cnh_category; date cnh_expires_at; status }
  vehicles { uuid id PK; uuid tenant_id; uuid carrier_partner_id FK; text plate; vehicle_type type "TRUCK_TRACTOR|TRAILER|BITRAIN|ROAD_TRAIN|TRUCK|OTHER"; numeric capacity_kg; text brand; text model; int year; status }
  commodities { uuid id PK; uuid tenant_id; text code; text name; text category; uuid default_unit_id; status }
  units { uuid id PK; uuid tenant_id "null = global"; text code "KG|T|SC60"; text name; numeric factor_to_kg }
```

**Justificativa**: um único `business_partners` com N `partner_roles` evita duplicar a mesma empresa que é compradora e vendedora. Transportadora é parceiro com papel `CARRIER` + `carrier_profiles` (RNTRC). A tabela `carriers` da lista original foi substituída por essa composição.

`unique (tenant_id, document) where deleted_at is null` em `business_partners`; `unique (tenant_id, plate)` em `vehicles`.

## Comercial e operação

```mermaid
erDiagram
  contracts ||--o{ loading_orders : origina
  loading_orders ||--o{ loading_order_versions : "snapshot por versão"
  loading_orders ||--o{ loading_order_releases : "liberações parciais"
  loading_orders ||--o{ loading_order_views : "faróis"
  loading_orders ||--o{ appointments : ""
  loading_orders ||--o{ loads : ""
  appointments |o--o| loads : "origina"
  loads ||--o{ load_status_history : ""
  loads ||--o{ invoices : ""
  invoices ||--o{ invoice_items : ""
  loads ||--o{ occurrences : ""
  loading_orders ||--o{ occurrences : ""

  contracts { uuid id PK; uuid tenant_id; text number; uuid seller_partner_id; uuid buyer_partner_id; uuid commodity_id; text crop_year; numeric quantity; uuid unit_id; numeric unit_price; char3 currency; numeric total_value; date starts_on; date ends_on; freight_mode freight_mode; contract_status status }
  loading_orders { uuid id PK; uuid tenant_id; text number UK; text external_number; order_status status; order_priority priority; int version; uuid contract_id; uuid seller_partner_id; uuid farm_id; uuid buyer_partner_id; uuid seller_org_id "RLS"; uuid buyer_org_id "RLS"; uuid commodity_id; numeric quantity; numeric released_qty; numeric scheduled_qty; numeric loaded_qty; numeric in_transit_qty; numeric received_qty; numeric cancelled_qty; numeric unit_price; numeric freight_estimate; numeric tolerance_pct; date loading_starts_on; date loading_ends_on; timestamptz published_at }
  loading_order_versions { uuid id PK; uuid order_id; int version; jsonb material_snapshot; jsonb changed_fields; uuid created_by; timestamptz created_at }
  loading_order_releases { uuid id PK; uuid order_id; int sequence; numeric quantity; date valid_until; release_status status; int order_version; uuid created_by }
  loading_order_views { uuid id PK; uuid order_id; uuid organization_id; uuid user_id; uuid membership_id; int version; timestamptz first_viewed_at; timestamptz last_viewed_at; int view_count; inet last_ip; text last_user_agent; uuid last_session_id }
  appointments { uuid id PK; uuid order_id; date scheduled_on; tstzrange window; numeric expected_qty; uuid carrier_partner_id; uuid driver_id; uuid tractor_vehicle_id; uuid trailer_vehicle_id; appointment_status status }
  loads { uuid id PK; uuid order_id; uuid appointment_id; text number; uuid carrier_partner_id; uuid driver_id; jsonb vehicle_plates; numeric expected_qty; numeric gross_kg; numeric tare_kg; numeric net_kg; numeric invoiced_qty; numeric received_qty; load_status status }
  invoices { uuid id PK; uuid load_id; char44 access_key UK; text number; text series; timestamptz issued_at; text issuer_cnpj; text recipient_cnpj; numeric total_value; numeric weight_kg; text plate; uuid file_upload_id; invoice_origin origin; jsonb raw_extract }
  occurrences { uuid id PK; uuid order_id; uuid load_id; occurrence_type type; severity severity; text description; uuid responsible_user_id; occurrence_status status; text resolution }
```

Totais de quantidade em `loading_orders` são **derivados** (atualizados na mesma transação de liberação/carga) e reconciliáveis a partir das tabelas filhas; cada mudança gera `audit_events`.

`seller_org_id`/`buyer_org_id` são denormalizações usadas pelas políticas RLS (evitam subqueries caras por linha); mantidas pela aplicação na mesma transação e validadas por constraint trigger.

## Transversais

```mermaid
erDiagram
  file_uploads ||--o| documents : "promovido para"
  audit_events { bigint id PK; uuid tenant_id; uuid actor_user_id; uuid actor_membership_id; text actor_role; text entity_type; uuid entity_id; text action; jsonb before; jsonb after; inet ip; text user_agent; uuid session_id; text request_id; text correlation_id; timestamptz occurred_at }
  outbox_events { uuid id PK; uuid tenant_id; text type; text aggregate_type; uuid aggregate_id; jsonb payload; timestamptz created_at; timestamptz published_at; int attempts; text last_error }
  file_uploads { uuid id PK; uuid tenant_id; uuid organization_id; text entity_type; uuid entity_id; text document_kind; text original_name; text declared_mime; text detected_mime; bigint size_bytes; text bucket; text object_key UK; text upload_id "multipart"; text sha256_declared; text sha256_actual; upload_status status; scan_status scan_status; text idempotency_key; uuid created_by }
  documents { uuid id PK; uuid tenant_id; uuid file_upload_id; text entity_type; uuid entity_id; text kind; visibility visibility "INTERNAL|FARM|BUYER"; bool critical }
  notifications { uuid id PK; uuid tenant_id; uuid user_id; text type; jsonb data; timestamptz read_at }
  saved_views { uuid id PK; uuid tenant_id; uuid user_id; text resource; text name; jsonb state; bool is_default }
  user_preferences { uuid user_id PK; text theme "light|dark|system"; bool sidebar_collapsed; jsonb data }
```

## Índices críticos

| Tabela | Índice |
|---|---|
| todas de negócio | `(tenant_id, …)` como prefixo |
| loading_orders | `(tenant_id, number)` unique; `(tenant_id, status, loading_starts_on)`; `(tenant_id, seller_partner_id)`; `(tenant_id, farm_id)`; `(tenant_id, buyer_partner_id)`; `(tenant_id, commodity_id)`; `(tenant_id, contract_id)`; `(tenant_id, seller_org_id)`; `(tenant_id, buyer_org_id)`; `(tenant_id, updated_at desc)`; trigram em `number` para busca |
| loads | `(tenant_id, order_id)`; `(tenant_id, status)`; GIN em `vehicle_plates` |
| vehicles | `(tenant_id, plate)` unique |
| invoices | `access_key` unique; `(tenant_id, load_id)` |
| loading_order_views | `(order_id, organization_id, user_id)` unique |
| audit_events | `(tenant_id, entity_type, entity_id, occurred_at desc)`; BRIN em `occurred_at` |
| outbox_events | `(published_at) where published_at is null` |
| sessions | `token_hash` unique; `(user_id) where revoked_at is null` |
| file_uploads | `(tenant_id, entity_type, entity_id)`; `(tenant_id, idempotency_key)` unique |
