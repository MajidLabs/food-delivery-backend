# Architecture

This document explains *why* the system is built the way it is - not just
what each part does, but the trade-offs behind each decision, including two
real bugs this project's own integration testing and a later precision
review caught. If you're skimming this as a portfolio reviewer: the
[messaging](#messaging-two-queues-per-service-on-purpose) and
[retry](#two-layers-of-retry) sections are the most substantive; the
[Next steps](#next-steps-for-a-production-deployment) section is a deliberately
honest list of what a production version would still need.

**Contents:** [Overview](#overview) · [Services](#services) ·
[One Postgres, three databases](#why-one-postgres-container-with-three-databases) ·
[Messaging](#messaging-two-queues-per-service-on-purpose) ·
[Order flow](#happy-path-order-flow) · [Retry](#two-layers-of-retry) ·
[Auth](#authentication) · [Caching](#caching) · [Logging](#logging) ·
[Health checks](#health-checks) · [Testing](#testing-strategy) ·
[CI/CD](#cicd) · [Next steps](#next-steps-for-a-production-deployment)

## Overview

Food Delivery Backend is a small but complete microservices system: one API
Gateway in front of three independent NestJS services, talking to each other
over RabbitMQ, backed by PostgreSQL (one database per service) and Redis for
read-through caching.

```
                                   ┌─────────────┐
                     HTTPS         │   Clients   │
                                   └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │ API Gateway │  :3000
                                   │  (NestJS)   │  JWT auth · Swagger · rate limit
                                   └──────┬──────┘
                     RPC (RabbitMQ, request/response)
                ┌─────────────┬───────────┴───────────┬─────────────┐
                │             │                        │
         ┌──────▼─────┐ ┌─────▼──────┐          ┌──────▼───────┐
         │   User     │ │   Order    │          │   Payment    │
         │  Service   │ │  Service   │          │   Service    │
         │   :3001    │ │   :3002    │          │    :3003     │
         └──────┬─────┘ └──┬──────┬──┘          └───┬──────┬───┘
                │          │      │  events (RabbitMQ)  │      │
                │          │      └──────────────────────┘      │
                │          │        order.created / payment.*   │
                │          │                                    │
                │          └──── Redis (cache) ───┘             │
                │                                                │
         ┌──────▼────────────────────▼────────────────────▼─────┐
         │           PostgreSQL  (user_db / order_db / payment_db)│
         └──────────────────────────────────────────────────────┘
```

## Services

| Service         | Port (HTTP) | Owns                | Talks to                                  |
|-----------------|:-----------:|---------------------|--------------------------------------------|
| api-gateway      | 3000        | HTTP surface, JWT verification, Swagger | user_queue, order_queue, payment_queue (RPC) |
| user-service     | 3001        | accounts, credentials, JWT issuance | user_db |
| order-service    | 3002        | orders, order status | order_db, Redis, payment_events_queue (emit) |
| payment-service  | 3003        | payment attempts     | payment_db, order_events_queue (emit) |

The HTTP ports on the backend services only serve `/health` - all business
traffic between the Gateway and the services goes over RabbitMQ. This is a
deliberate hybrid-app pattern (`app.connectMicroservice()` + `app.listen()`
in the same process): each service ends up with a plain, curl-able health
endpoint for Docker/orchestrator checks (see [Health checks](#health-checks)
for what it actually checks and why that's closer to readiness than
liveness), without having to expose a second HTTP business API.

## Why one Postgres container with three databases

Each service owns its schema and only ever connects to its own database -
that boundary is what "database per service" is actually about. Running
three separate Postgres *containers* would model production more closely,
but for a docker-compose demo a single instance with `user_db` / `order_db`
/ `payment_db` (created by `infra/postgres/init-multi-db.sh` on first boot)
is lighter and just as effective at enforcing the boundary. In a real
deployment, swap this for three managed instances (or three RDS/Cloud SQL
databases) - nothing in the application code assumes co-location.

## Messaging: two queues per service, on purpose

`@nestjs/microservices`' RabbitMQ transport routes by matching the `pattern`
string inside the message payload against `@MessagePattern`/`@EventPattern`
decorators - not by RabbitMQ routing keys. That means a service *could* get
away with a single inbound queue. This project deliberately splits each
service's traffic into two queues instead:

| Queue                  | Ack mode     | Carries                                | Consumed by |
|-------------------------|-------------|------------------------------------------|-------------|
| `user_queue`             | auto (default) | `auth.register`, `auth.login`, `user.findById` | user-service |
| `order_queue`            | auto (default) | `order.create`, `order.findById`, `order.findAllByUser` | order-service |
| `payment_queue`          | auto (default) | `payment.findByOrderId` | payment-service |
| `order_events_queue`     | **manual**  | `payment.completed`, `payment.failed` | order-service |
| `payment_events_queue`   | **manual**  | `order.created` | payment-service |

The `*_queue` ones carry request/response (RPC) traffic. If a handler
throws, the caller - always the Gateway - sees the error immediately and
already retries the call itself (see below), so redelivery doesn't help and
auto-ack keeps the handlers simple.

The `*_events_queue` ones carry fire-and-forget domain events between
services (`order.created`, `payment.completed`, `payment.failed`). These
mutate state as a side effect and can legitimately fail transiently (a
flaky DB connection, a dependency briefly down), so they run in manual-ack
mode: the handler only acks after it succeeds, and a failure triggers the
redelivery-with-retry-count path described below.

*(This "manual" row is implementation-sensitive enough that it's worth
saying how it was checked, not just asserted: `order-service/src/main.ts`
and `payment-service/src/main.ts` set `noAck: false` on these two queues;
`order-events.controller.ts` / `payment-events.controller.ts` receive
`@Ctx() context: RmqContext` and pass it into `handleWithRetry`, which calls
`context.getChannelRef().ack(...)` / `.nack(...)` directly - real amqplib
channel calls, not an abstraction that only looks like manual ack. Verified
by reading those five files together, not inferred from the config alone.)*

**Both sides of a queue must declare identical arguments.** Order Service's
`ClientProxy` producer and Payment Service's `Server` consumer both
reference `payment_events_queue` (symmetrically for `order_events_queue`
between Payment -> Order). Whichever one connects to RabbitMQ first
implicitly creates the queue with its own `queueOptions`; the other must
declare the exact same arguments (here, `x-dead-letter-exchange`) or
RabbitMQ rejects the second declaration with `406 PRECONDITION_FAILED` and
tears down that connection - which, left unhandled, crashes the whole
process. This bit us during integration testing (see the comments next to
`arguments:` in `orders.module.ts` / `payments.module.ts`) - the DLX
argument only lived on the consumer side, so the producer's lazy first
`.emit()` call bootstrapped a queue-argument mismatch. Fixed by mirroring
the argument on both declarations.

## Happy-path order flow

1. `POST /orders` (Gateway, JWT-protected) -> RPC `order.create` on
   `order_queue`. Order Service saves the order as `PENDING` and returns
   immediately.
2. Order Service emits `order.created` on `payment_events_queue`
   (fire-and-forget).
3. Payment Service consumes it, calls the (simulated) payment provider -
   wrapped in exponential-backoff retry - and saves a `Payment` row as
   `SUCCESS` or `FAILED`.
4. Payment Service emits `payment.completed` / `payment.failed` on
   `order_events_queue`.
5. Order Service consumes it, updates the order to `CONFIRMED` / `FAILED`,
   and invalidates the Redis cache entry for that order.
6. `GET /orders/:id` reads through Redis (60s TTL) -> falls back to
   PostgreSQL on a miss.

The async part of that (steps 2–5) as a sequence diagram:

```
Client                                                                
  │ POST /orders                                                     
  ▼                                                                   
API Gateway                                                           
  │ RPC order.create  (order_queue)                                  
  ▼                                                                   
Order Service ──save PENDING──► 201 { status: PENDING } back to Client
  │                                                                    
  │ emit order.created  (payment_events_queue)                       
  ▼                                                                   
Payment Service                                                       
  │ withRetry: call payment provider (up to 3 attempts total)        
  │ save Payment row - SUCCESS or FAILED                              
  ▼                                                                   
  │ emit payment.completed / payment.failed  (order_events_queue)    
  ▼                                                                   
Order Service                                                         
  │ update status -> CONFIRMED / FAILED                                
  │ invalidate Redis key  order:<id>                                  
  ▼                                                                   
Redis  (cache cleared - next GET /orders/:id repopulates it)          
```

Everything from "emit order.created" onward happens after the Gateway has
already returned `201 PENDING` to the client - this is the whole point of
routing it through an event instead of making the client wait on the
payment provider synchronously.

## Two layers of retry

**In-process, exponential backoff (`common/retry.util.ts` -> `withRetry`)** -
used where a single call might just need a moment to succeed:
- API Gateway wraps every downstream RPC call (`common/rpc-call.util.ts`).
- Payment Service wraps its simulated external-gateway call.

**Message-level, redelivery-count + dead-letter (`common/rmq-retry.util.ts`
-> `handleWithRetry`)** - used on the two event queues, which run in manual-ack
mode. On failure the handler re-queues the message with an incremented
`x-retry-count` header; after 3 attempts it's nacked without requeue, which
routes it (via each queue's `x-dead-letter-exchange` argument) to a durable
`.dlq` queue pre-declared in `infra/rabbitmq/definitions.json`. This survives
a process restart, unlike the in-process retry. A production system would
add a delay exchange for real backoff between redeliveries - republishing
immediately is enough to demonstrate the counting/dead-lettering mechanism
without pulling in the RabbitMQ delayed-message plugin.

RPC exceptions raised inside a service use the shape `{ status, message }`
(via `RpcException`). The Gateway's `callService()` helper unwraps that into
a proper `HttpException`, so a `404` from Order Service becomes an actual
HTTP 404, not a generic 500.

**A second thing this bit us on: durable queues alone don't persist
messages.** All five queues are declared `durable: true`, meaning the queue
*definition* survives a broker restart - but `@nestjs/microservices`
defaults every published message to `persistent: false`
(`RQM_DEFAULT_PERSISTENT` in its source), meaning the message *content*
does not. A durable queue with non-persistent messages is a known AMQP
half-measure: fine for the RPC queues (a broker restart mid-request just
fails that request, which the Gateway's retry already handles), but wrong
for the event queues - a broker crash between `order.created` being
accepted and Payment Service consuming it would silently lose that event
forever, leaving the order stuck `PENDING` with no error anywhere. This was
missing until a review pass questioned how "durable" the messaging really
was; the fix is `persistent: true` on all five `ClientsModule`
registrations (`clients.module.ts` in the Gateway, and the
`*_EVENTS_CLIENT` in Order/Payment Service). Verified past the config
layer, at the actual AMQP wire level: enabling RabbitMQ's trace/firehose
feature (`rabbitmqctl trace_on`) and capturing live traffic during a real
order shows `delivery_mode: 2` (AMQP's persistent flag) on every message to
`user_queue`, `order_queue`, `payment_events_queue`, and
`order_events_queue` - not inferred from reading the client library's
source, observed on the wire.

**Known limitation: at-least-once, not exactly-once.** `handleWithRetry`
only acks after the handler resolves, which is correct for the failure
cases it's designed for - but if the *process itself* dies mid-handler
(after the payment/DB write, before the ack reaches RabbitMQ), the broker
will redeliver that message to the next consumer, and it runs again from
scratch. For `updateStatusFromPayment` that's harmless (setting the same
status twice is a no-op). For `processOrderPayment` it isn't: a second run
would insert a second `Payment` row and emit a second `payment.completed`
event for the same order. This is a real gap, not a hidden one - closing it
means an idempotency key (e.g. dedupe on `orderId` before inserting a
payment) or a transactional outbox, both listed under
[Next steps](#next-steps-for-a-production-deployment).

## Authentication

User Service is the source of truth for credentials: `bcryptjs` hashes
passwords (pure-JS, so it doesn't need native build tools in the Alpine
Docker image - a deliberate swap from `bcrypt`), and it signs JWTs itself on
login using a secret shared with the Gateway (`JWT_SECRET`). The Gateway
verifies incoming bearer tokens locally with a Passport JWT strategy - it
does **not** round-trip to User Service on every request. That keeps
protected endpoints fast and avoids making User Service a single point of
failure for every authenticated call, at the cost of the two services
needing to agree on a shared secret (in production, prefer asymmetric
signing so only User Service holds the private key).

## Caching

Order Service caches `GET /orders/:id` responses in Redis for 60 seconds,
keyed by `order:<id>`. The cache is explicitly invalidated the moment an
order's status changes (`updateStatusFromPayment`), so a client polling an
order right after payment completes never sees stale `PENDING` data for
longer than it takes that one event to process.

## Logging

Every service installs a small `AppLogger` (extends Nest's `ConsoleLogger`)
that writes structured JSON lines instead of Nest's default colored text -
cheap to add (no extra dependency) and immediately usable by any log
aggregator. A `LoggingInterceptor`, applied globally, logs every HTTP
request or RPC/event message with its handler name, duration, and outcome.
The Gateway additionally runs a `CorrelationIdMiddleware` that reads or
generates `x-correlation-id` and echoes it back on the response - a starting
point for tracing a request across services, though full propagation across
the message bus (and a proper tracing backend) is a good next step, not
included here to keep the demo focused.

## Health checks

Each service exposes `GET /health` via `@nestjs/terminus`:
- Gateway: process memory heap only (it holds no state of its own).
- User/Payment Service: PostgreSQL connectivity + memory heap.
- Order Service: PostgreSQL + Redis connectivity + memory heap.

This is a **readiness-style check, not a pure liveness check** - a process
whose database connection is down hasn't crashed, it just isn't ready to
serve traffic correctly, and those are different questions. Docker's
`HEALTHCHECK` instruction doesn't distinguish the two the way Kubernetes'
`livenessProbe`/`readinessProbe` split does, so this single endpoint has to
answer both here; the distinction still matters when reading the result.

RabbitMQ connectivity is deliberately left out of this endpoint, but not
because "the broker can just go away and everything's fine" - that would be
overstating it. What's actually true, checked against the installed
`@nestjs/microservices` and `amqp-connection-manager` source rather than
assumed: both the client (`ClientProxy`) and server (consumer) sides
connect through `amqp-connection-manager`, which retries connecting
indefinitely by default (`maxConnectionAttempts` defaults to infinite) - a
service doesn't crash just because RabbitMQ isn't reachable yet. On
reconnect, the server side re-declares its queue and re-registers its
consumer automatically (`ServerRMQ.setupChannel` re-runs
`channel.assertQueue` + `channel.consume` every time, because
`amqp-connection-manager` re-invokes that `setup` function after every
reconnect). On the client side, `.send()`/`.emit()` calls made while
disconnected are queued in memory and flushed once the connection returns,
per `ChannelWrapper`'s own documented behavior. So: a service does ride out
a broker restart without needing to be restarted itself, and won't
necessarily drop messages published during that window either - but that
in-memory client-side buffer is exactly that, in-memory, so it does *not*
survive the **application process** restarting, only a broker-side blip
while the app keeps running. Combined with the `persistent: true` fix
above, messages that do reach the broker before an outage also survive a
broker restart; messages still sitting in a disconnected client's buffer
when the *app* goes down do not. That's a real, bounded claim, not "the
broker can vanish and nothing is lost."

Given that reconnect behavior is handled by the transport itself, putting
RabbitMQ connectivity into `/health` would mostly just make the container
report unhealthy during a window it's already designed to recover from on
its own - which is the actual reason it's excluded, not broker outages
being cost-free.

Docker's `HEALTHCHECK` instruction in each Dockerfile calls this endpoint
with `wget`.

## Testing strategy

Three distinct things, worth keeping separate rather than lumping together
as "testing": **24 automated tests** that run in CI on every push, a
**20-assertion automated smoke-test script** you run yourself against a
live stack, and a **one-time manual verification pass** (below) that isn't
automated at all and shouldn't be read as if it were.

Every service ships fast, dependency-free **unit tests** (`*.spec.ts`
co-located with the code, Jest + `@nestjs/testing`, repositories and RMQ
clients mocked) covering the actual business logic: password hashing and
credential checks, order total calculation and cache read-through, and the
simulated-payment success/failure paths (including the retry utility
itself). These are what CI runs - 22 of the 24 automated tests.

The Gateway additionally has one **e2e test file** (`test/app.e2e-spec.ts`,
2 tests) that boots the real `AppModule` and hits `/health` and an
unauthenticated `/orders` call over HTTP - safe to run without any live
infrastructure, since RabbitMQ `ClientProxy` connections in this transport
are lazy (nothing connects until a handler actually calls `.send()`/
`.emit()`). 22 unit + 2 e2e = the 24 automated tests referenced elsewhere in
this project's docs.

User/Order/Payment Service don't get an equivalent e2e test: their
`AppModule` eagerly opens a real PostgreSQL connection via TypeORM at
`onModuleInit`, which isn't available in a plain CI runner without adding
service containers. `docker-compose up` is the intended way to exercise
these three end-to-end; adding `testcontainers`-based e2e tests against real
Postgres/RabbitMQ is a natural next step.

Separately - and this is the **manual, non-automated** part - the full
stack has also been verified by hand, end-to-end, against real (non-Docker)
PostgreSQL, Redis, and RabbitMQ instances: register -> login -> place an
order -> async `order.created`/`payment.completed` round trip -> order flips
`PENDING` -> `CONFIRMED`, with the Redis cache invalidated and repopulated
correctly - confirmed both via the HTTP API and by querying Postgres/Redis
directly. Ownership checks (403 on another user's order), 404s, and
invalid-token handling were exercised the same way. This pass is what
caught both the queue-argument mismatch and the missing `persistent: true`
described earlier in this document, and it's exactly why it's called out
as manual rather than folded into the "24 tests" count: nothing about it
runs unattended or repeatably the way the automated suite does.

That same manual pass is now [`scripts/health-check.sh`](./scripts/health-check.sh)
- a 20-assertion automated smoke test, separate from the 24 unit/e2e tests
above, that you run yourself against your own `docker compose up` to
reproduce that verification in one command rather than by hand. See
[CHECKLIST.md](./CHECKLIST.md) for the full verification checklist,
including what to check before the script has a running stack to point at
(build, lint, container health).

## CI/CD

`.github/workflows/ci.yml` runs three stages per service, fanned out with a
matrix over the four `services/*` directories:

1. **test** - `npm ci`, `npm run lint`, `npm test -- --coverage`,
   `npm run build`.
2. **docker-build** - builds each service's image (not pushed), using the
   GitHub Actions cache so repeat builds are fast.
3. **publish** - only on a push to `main`: builds and pushes each image to
   GitHub Container Registry, tagged `latest` and with the commit SHA. Uses
   the automatically-provided `GITHUB_TOKEN`, so it works with zero secret
   configuration.

## Next steps for a production deployment

- A transactional outbox on the producer side: `orders.service.ts` saves
  the order row and then separately calls
  `paymentEventsClient.emit('order.created', ...)`, and
  `payments.service.ts` does the same for `payment.completed` /
  `payment.failed`. A crash (or a dropped RabbitMQ connection) between the
  DB save and that `emit()` call leaves the row committed with no event
  ever sent - today nothing detects or replays it, so the order is stuck
  in `PENDING` permanently. Writing the event to an outbox table in the
  same transaction as the row, then having a separate relay process
  publish from that table, closes this gap.
- Replace `synchronize: true` with real TypeORM migrations.
- Separate Postgres instances (or managed databases) per service.
- Idempotency keys (or a transactional outbox) on the event handlers that
  write data, so a crash-induced redelivery can't create a duplicate
  payment - see the limitation noted under [Two layers of retry](#two-layers-of-retry).
- Asymmetric JWT signing (RS256) so only User Service holds the private key.
- Propagate the correlation id through RabbitMQ message headers (e.g. via
  `AsyncLocalStorage`) and add OpenTelemetry for real distributed tracing.
- A delay exchange (or the RabbitMQ delayed-message plugin) for real
  backoff between message redeliveries, instead of immediate republish.
- Redis-backed rate-limiter storage for `@nestjs/throttler` once the
  Gateway runs more than one replica.
- `testcontainers`-based integration tests for the three backend services.
- Kafka is a reasonable alternative to RabbitMQ here if event volume grows
  enough to want partitioned consumers and replay - the event contracts
  above (`order.created`, `payment.completed`, `payment.failed`) would
  carry over largely unchanged.
