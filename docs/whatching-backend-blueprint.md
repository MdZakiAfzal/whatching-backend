# Whatching Backend Blueprint

## Goal

Build Whatching as a professional, secure, multi-tenant WhatsApp automation SaaS backend that:

1. passes Meta review and supports Tech Provider onboarding flows
2. supports multiple businesses safely from one backend
3. can scale with workers, queues, retries, and webhook-driven flows
4. gives the frontend team stable, API-first contracts

This document is the implementation blueprint for the backend roadmap.

## Core Principles

1. Modular monolith first
   - Keep one API service and separate worker processes.
   - Do not split into microservices too early.

2. Multi-tenant by default
   - Every business-owned record must carry `orgId`.
   - Every query, queue job, webhook, and outbound action must be org-scoped.

3. Async by default for external work
   - Webhooks, Meta sync, broadcast fanout, and delivery updates should not block HTTP requests.
   - Use Redis + BullMQ for background processing.

4. Source of truth locally
   - Keep a local copy of business-critical state such as templates, messages, and integration health.
   - Do not depend only on live reads from Meta.

5. Review-first sequencing
   - Build the smallest complete product slice that proves legitimacy to Meta first.
   - Expand into broadcasts, flows, and AI later.

## Recommended Runtime Architecture

### Services

- `api`
  - Express + TypeScript
  - Handles auth, org routes, template routes, message routes, webhook receipt
- `worker`
  - BullMQ workers
  - Processes WhatsApp webhooks, outbound messages, template sync, broadcasts
- `scheduler`
  - Periodic jobs for reconciliation, health checks, stale job recovery
- `redis`
  - Queue backend, rate-limiting state, distributed locks, idempotency support
- `mongo`
  - Primary application database

### Why this shape

- The API remains fast and stateless.
- Workers isolate slow or bursty workloads.
- Redis gives us operational control without forcing an early microservice split.

## Current Backend Baseline

Already present in the repo:

- auth, verification, password reset
- organization setup and team membership
- SaaS billing subscriptions and legacy wallet top-ups
- Embedded Signup token exchange and org-level Meta config storage
- WhatsApp webhook verification endpoint
- payment webhook handling
- subscriber and conversation base models

Still missing or only stubbed:

- template management
- outbound WhatsApp message sending
- inbound WhatsApp message persistence
- conversation message history APIs
- worker/queue infrastructure
- integration health and audit modules

## Phase Plan

### Phase 1: Meta Review Slice

Ship the smallest fully real backend that supports a clean demo path:

1. auth and org creation
2. Embedded Signup completion
3. integration status endpoint
4. template management
5. template send endpoint
6. inbound webhook persistence and processing
7. subscriber + conversation creation from inbound events
8. audit trail for key integration actions

Demo path:

1. user signs up
2. user creates organization
3. user connects Facebook business through Embedded Signup
4. backend stores WABA and phone linkage
5. user sees template list
6. user creates or syncs templates
7. user sends approved template message
8. inbound webhook events create subscriber and conversation records

### Phase 2: Inbox Slice

1. subscriber listing and filtering
2. conversation listing
3. message timeline
4. assignment to agents
5. conversation status updates
6. delivery/read/failed status sync
7. agent replies within the active customer service window
8. inbound media download from Meta and durable media storage
9. bulk subscriber import with plan-aware limits

### Phase 3: Broadcast Slice

1. create broadcast
2. choose audience by all subscribers, tags, or explicit subscriber selection
3. schedule by UTC or local business timezone
4. personalize template variables per recipient at send time
5. enqueue per-recipient jobs
6. track per-recipient delivery outcomes
7. usage tracking plus SaaS plan enforcement
8. Meta messaging-tier warnings before large sends

### Phase 4: Hybrid Bot + Live Inbox

1. deterministic interactive bot trees
2. AI fallback with knowledge-base retrieval
3. human takeover governance with rolling auto-timeout
4. live inbox events for a WhatsApp-like chat UI
5. bot builder and knowledge-source management

## Data Model Plan

### Keep and extend existing models

#### Organization

Extend with:

- `metaConfig.status`
- `metaConfig.connectedAt`
- `metaConfig.webhookVerifiedAt`
- `metaConfig.lastTemplateSyncAt`
- `metaConfig.lastHealthCheckAt`
- `metaConfig.businessAccountName`
- `metaConfig.displayPhoneNumber`
- `messagingBilling.mode`
- `messagingBilling.provider`
- `messagingBilling.creditSharingStatus`
- `usage.templateMessagesSent`
- `usage.sessionMessagesSent`
- `usage.lastMessageAt`

#### Subscriber

Keep as the contact-level source of truth per org.

Suggested additions:

- `waId`
- `optInSource`
- `customAttributes`
- `lastInboundAt`
- `lastOutboundAt`

#### Conversation

Use as the inbox thread container.

Suggested additions:

- `lastMessageAt`
- `lastInboundAt`
- `lastOutboundAt`
- `unreadCount`
- `channel`
- `priority`
- `mode`
- `activeFlowId`
- `activeTriggerKey`
- `lastBotMessageId`
- `handoffRequestedAt`
- `handoffReason`
- `manualTakeoverAt`
- `manualTakeoverBy`
- `lastAgentReplyAt`
- `automationPausedUntil`
- `lastInboundMetaMessageId`
- `lastOutboundMetaMessageId`

### New models to add

#### WhatsAppTemplate

Purpose:
- Local store for Meta template state

Fields:
- `orgId`
- `wabaId`
- `templateId`
- `name`
- `language`
- `category`
- `status`
- `components`
- `rejectionReason`
- `qualityScore`
- `namespace`
- `lastSyncedAt`

Indexes:
- `{ orgId: 1, templateId: 1 }`
- `{ orgId: 1, name: 1 }`
- `{ orgId: 1, status: 1 }`

#### TemplateDraft

Purpose:
- Local pre-submission template editing and review workflow

Fields:
- `orgId`
- `createdBy`
- `updatedBy`
- `name`
- `language`
- `category`
- `components`
- `allowCategoryChange`
- `status`
- `metaTemplateId`
- `rejectionReason`
- `lastSubmittedAt`

#### Message

Purpose:
- Source of truth for inbound and outbound messages

Fields:
- `orgId`
- `conversationId`
- `subscriberId`
- `direction`
- `type`
- `metaMessageId`
- `templateId`
- `status`
- `payload`
- `errorCode`
- `errorMessage`
- `sentAt`
- `deliveredAt`
- `readAt`
- `failedAt`

Indexes:
- `{ orgId: 1, conversationId: 1, createdAt: -1 }`
- `{ orgId: 1, metaMessageId: 1 }`
- `{ orgId: 1, status: 1 }`

#### WebhookEvent

Purpose:
- Durable record of raw webhook events for replay and debugging

Fields:
- `orgId`
- `provider`
- `eventType`
- `eventId`
- `signatureVerified`
- `payload`
- `processingStatus`
- `processedAt`
- `error`

Indexes:
- `{ provider: 1, eventId: 1 }`
- `{ orgId: 1, processingStatus: 1 }`
- `{ createdAt: 1 }`

#### IntegrationLog

Purpose:
- Audit and debugging for Meta connection actions

Fields:
- `orgId`
- `actorUserId`
- `action`
- `status`
- `details`
- `externalRef`

#### Broadcast

Purpose:
- Campaign-level record

Fields:
- `orgId`
- `name`
- `templateId`
- `status`
- `audienceQuery`
- `scheduledAt`
- `startedAt`
- `completedAt`
- `stats`
- `startedBy`
- `lastError`

Audience shape currently supported:
- `mode: 'all'`
- `mode: 'tags'` with `tags[]` and `tagMatch: 'any' | 'all'`
- `mode: 'specific'` with `subscriberIds[]`
- `optedInOnly`

#### BroadcastRecipient

Purpose:
- Per-recipient broadcast send tracking

Fields:
- `orgId`
- `broadcastId`
- `subscriberId`
- `messageId`
- `status`
- `error`

#### BotFlow

Purpose:
- Published bot blocks for deterministic WhatsApp routing

Core fields:
- `orgId`
- `status`
- `triggerKey`
- `name`
- `blockType`
- `content`
- `actions[]`
- `sortOrder`
- `version`

#### BotSettings

Purpose:
- Org-level bot configuration for greetings, AI, and timeout behavior

Core fields:
- `orgId`
- `isBotEnabled`
- `isAiEnabled`
- `systemPrompt`
- `defaultTriggerKey`
- `greetingKeywords[]`
- `escalationTriggerIds[]`
- `autoTimeoutMinutes`
- `geminiModel`

#### KnowledgeSource

Purpose:
- Raw text/FAQ/file inputs for bot AI grounding

Core fields:
- `orgId`
- `type`
- `status`
- `title`
- `content`
- `faqEntries`
- `filename`
- `mimeType`
- `cloudinaryUrl`
- `chunkCount`
- `lastIngestedAt`

#### KnowledgeChunk

Purpose:
- Searchable chunks derived from `KnowledgeSource`

Core fields:
- `orgId`
- `sourceId`
- `order`
- `content`
- `normalizedContent`

## Queue Design

### Required queues

- `whatsapp:webhook-process`
- `meta:template-sync`
- `messages:template-send`
- `messages:status-sync`
- `broadcasts:fanout`
- `billing:reconcile`
- `integration:health-check`
- `bot:knowledge-ingest`
- `bot:conversation-timeout`

### Job payload shape

Every job payload should include:

- `orgId`
- `initiatedBy`
- `traceId`
- `createdAt`
- module-specific data

### Queue policies

- retries with backoff for transient provider failures
- dead-letter handling for poison jobs
- per-job idempotency keys where possible
- concurrency controls per queue
- rate limiting for Meta API-sensitive jobs

## HTTP API Blueprint

### Auth

Keep existing routes and harden them.

### Organization and integration

- `POST /api/v1/organizations/setup`
- `GET /api/v1/organizations/my-organizations`
- `GET /api/v1/organizations`
- `PATCH /api/v1/organizations/connect-meta`
- `GET /api/v1/organizations/integration-status`
  - includes `messagingBilling`
  - includes `messagingLimitTier`, `qualityRating`, `qualityStatus`, `activeAlerts`, and `timezone`
- `POST /api/v1/organizations/integration/sync`
- `PATCH /api/v1/organizations/settings`

### Templates

- `GET /api/v1/organizations/templates`
- `POST /api/v1/organizations/templates`
- `GET /api/v1/organizations/templates/:templateId`
- `DELETE /api/v1/organizations/templates/:templateId`
- `POST /api/v1/organizations/templates/sync`
- `GET /api/v1/organizations/templates/drafts`
- `POST /api/v1/organizations/templates/drafts`
- `GET /api/v1/organizations/templates/drafts/:draftId`
- `PATCH /api/v1/organizations/templates/drafts/:draftId`
- `POST /api/v1/organizations/templates/drafts/:draftId/submit`
- `DELETE /api/v1/organizations/templates/drafts/:draftId`

### Messaging

- `POST /api/v1/organizations/messages/template-send`
- `GET /api/v1/organizations/messages/:messageId`
- `POST /api/v1/organizations/conversations/:conversationId/reply`
  - supports text and agent-uploaded media replies

### Inbox

- `GET /api/v1/organizations/conversations`
- `GET /api/v1/organizations/conversations/:conversationId`
- `GET /api/v1/organizations/conversations/:conversationId/messages`
- `GET /api/v1/organizations/conversations/:conversationId/context`
- `PATCH /api/v1/organizations/conversations/:conversationId/assign`
- `PATCH /api/v1/organizations/conversations/:conversationId/status`
- `PATCH /api/v1/organizations/conversations/:conversationId/read`
- `POST /api/v1/organizations/conversations/:conversationId/reply`

### Chat

- `GET /api/v1/organizations/chat/bootstrap`

### Subscribers

- `GET /api/v1/organizations/subscribers`
- `POST /api/v1/organizations/subscribers/import`
- `GET /api/v1/organizations/subscribers/:subscriberId`
- `PATCH /api/v1/organizations/subscribers/:subscriberId`
- `PATCH /api/v1/organizations/subscribers/:subscriberId/tags`

### Broadcasts

- `POST /api/v1/organizations/broadcasts`
- `GET /api/v1/organizations/broadcasts`
- `GET /api/v1/organizations/broadcasts/:broadcastId`
- `POST /api/v1/organizations/broadcasts/:broadcastId/start`
- `POST /api/v1/organizations/broadcasts/:broadcastId/cancel`

Behavior:
- create stores a draft broadcast
- start can run immediately or accept `scheduledAt` or `scheduledLocal + timezone`
- components may contain dynamic per-recipient value resolvers for subscriber fields and metadata
- detail returns paginated recipients and delivery outcomes

### Bot

- `GET /api/v1/organizations/bot/settings`
- `PATCH /api/v1/organizations/bot/settings`
- `GET /api/v1/organizations/bot/flows`
- `POST /api/v1/organizations/bot/flows`
- `GET /api/v1/organizations/bot/flows/:flowId`
- `PATCH /api/v1/organizations/bot/flows/:flowId`
- `POST /api/v1/organizations/bot/flows/:flowId/publish`
- `POST /api/v1/organizations/bot/flows/:flowId/archive`
- `GET /api/v1/organizations/bot/knowledge-sources`
- `POST /api/v1/organizations/bot/knowledge-sources/text`
- `POST /api/v1/organizations/bot/knowledge-sources/upload`
- `DELETE /api/v1/organizations/bot/knowledge-sources/:sourceId`
- `POST /api/v1/organizations/bot/knowledge-sources/:sourceId/reingest`
- `GET /api/v1/organizations/bot/status`

## Worker Flows

### WhatsApp webhook flow

API:

1. verify webhook signature
2. store `WebhookEvent`
3. enqueue `whatsapp:webhook-process`
4. return `200` immediately

Worker:

1. parse event type
2. map event to `orgId`
3. upsert subscriber
4. create/update conversation
5. persist `Message`
6. download inbound media from Meta when required and upload to durable storage
7. update delivery states if status event
8. process template-status and phone-quality events
9. mark webhook event processed

### Template sync flow

1. pull templates from Meta for org WABA
2. upsert `WhatsAppTemplate` records
3. mark missing templates archived if necessary
4. update `metaConfig.lastTemplateSyncAt`
5. keep `TemplateDraft` review state aligned with Meta template status

### Template send flow

1. validate org integration is ready
2. validate template exists locally and is approved
3. enqueue send job
4. worker sends through Meta
5. persist outbound `Message`
6. webhook later updates delivery/read/failed states

### Broadcast flow

1. create broadcast record
2. snapshot audience
3. resolve per-recipient template variables
4. create recipient jobs
5. worker sends per recipient
6. update usage counters and plan-governed limits
7. roll up stats to `Broadcast`

### Bot orchestration flow

1. webhook worker persists inbound message and emits live inbox updates
2. if the conversation is in active manual mode, stop after persistence
3. if the conversation is pending escalation, stop after persistence
4. if inbound is a button or list reply, route through the active published flow
5. if inbound text matches greeting keywords, send `DEFAULT`
6. otherwise retrieve KB chunks and run Gemini fallback
7. if AI requests human help, mark conversation pending and emit escalation
8. if an agent replies manually, switch to `agent_manual` and refresh timeout
9. when timeout expires, resume bot mode and resolve the thread

### Integration health flow

1. sync WABA phone-level quality and messaging tier state
2. update org-level `activeAlerts`
3. expose warnings to UI and broadcast creation/start flows
4. repeat automatically on a daily schedule

## Billing Model

- Whatching uses Razorpay for SaaS subscription billing only.
- Meta messaging usage is billed directly to the connected business by default.
- Wallet balance is retained only as legacy/internal infrastructure and must not gate template sends or inbox replies.
- Future partner credit-line support should be added through `messagingBilling.mode = 'partner_credit_line'` instead of reusing wallet deductions.

## Security Requirements

### Tenant isolation

- All org-owned queries must include `orgId`.
- Do not trust client-submitted org data without membership checks.

### Secrets and tokens

- Keep Meta access tokens encrypted at rest.
- Never return raw provider tokens to the frontend.
- Support token rotation.

### Webhooks

- Verify signatures before processing.
- Store raw payloads for replay.
- Use idempotent processing.

### Authz

- `owner` can manage billing, Meta integration, templates
- `admin` can manage inbox and operational settings
- `agent` can work conversations only

### Validation

- Request validation on all write routes
- enum guards for statuses and template categories
- strict payload shape for worker jobs

### Auditing

Log:

- integration connect/disconnect
- template create/delete/sync
- message send attempts
- billing actions
- role changes

## Observability

Minimum:

- request logs
- worker logs
- failed job logs
- webhook processing logs
- integration sync logs

Recommended:

- correlation IDs across API and workers
- structured JSON logs in production
- queue dashboards
- alert on failed recurring jobs

## API Contract Discipline

Because frontend is being built by another team:

1. publish a route contract before implementation starts
2. keep a shared Postman collection or OpenAPI spec
3. return stable response shapes
4. include integration status objects designed for UI consumption

Suggested integration status response:

```json
{
  "status": "success",
  "data": {
    "integration": {
      "state": "ready",
      "wabaId": "123",
      "phoneNumberId": "456",
      "displayPhoneNumber": "+1 555 000 0000",
      "webhookVerified": true,
      "lastTemplateSyncAt": "2026-05-07T10:00:00.000Z"
    }
  }
}
```

## Phase 1 Build Order

### Step 1

Add infrastructure:

- Redis
- BullMQ
- queue module
- worker entrypoint
- webhook event persistence

### Step 2

Add integration status module:

- org integration health endpoint
- sync endpoint
- audit logs

### Step 3

Add template management:

- model
- service
- controller
- routes
- sync job

### Step 4

Add template sending:

- outbound message model
- send endpoint
- worker send job
- delivery status handling

### Step 5

Add inbox foundation:

- subscriber query endpoints
- conversation endpoints
- inbound webhook processor

## Out of Scope Until After Review

Do not let these delay Phase 1:

- AI agent workflows
- advanced flow builder
- Instagram support
- complex analytics dashboards
- white-labeling
- broad CRM features beyond WhatsApp contact and conversation basics

## Immediate Next Implementation Target

The next concrete module to build should be:

1. Redis + BullMQ foundation
2. `WebhookEvent` model
3. `WhatsAppTemplate` model
4. template sync and template CRUD routes
5. template send endpoint

That gives the fastest path to a credible Meta review-ready backend.
