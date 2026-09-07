# Health Checklist

A step-by-step way to verify this project actually works — for yourself,
before a demo, or after cloning it fresh. Two ways to use it:

- **Fast path:** run [`scripts/health-check.sh`](./scripts/health-check.sh)
  against a running stack — it automates the entire "Functional flow" and
  "Negative / edge paths" sections below (20 checks) and prints a clear
  pass/fail summary.
- **Full path:** work through every box in this document by hand — useful
  the first time, or if the script itself reports a failure and you need to
  narrow down where.

Check items off as you go. If something fails, the relevant section of
[ARCHITECTURE.md](./ARCHITECTURE.md) explains how that piece is supposed to
work, which is usually the fastest way to spot what's different.

## 0. Prerequisites

- [ ] Docker and Docker Compose are installed (`docker --version`,
      `docker compose version`) — for the Docker path.
- [ ] **or**, for the no-Docker path: Node.js 20+ (`node --version`,
      matches [`.nvmrc`](./.nvmrc)), plus local PostgreSQL, Redis, and
      RabbitMQ.
- [ ] Ports `3000`–`3003`, `5432`, `6379`, `5672`, `15672` are free on your
      machine.

## 1. Static checks (nothing running yet)

```bash
make install    # npm install in all four services
make lint       # ESLint, all four services
make build-ts   # tsc compiles cleanly, all four services
make test       # Jest unit tests, all four services (22 tests)
make test-e2e   # api-gateway's e2e suite (2 tests, no infra required)
```

- [ ] `make install` finishes without errors
- [ ] `make lint` reports no problems
- [ ] `make build-ts` compiles all four services
- [ ] `make test` → **22 passed**, 0 failed, across the four services
- [ ] `make test-e2e` → **2 passed** (`/health` returns ok, `/orders`
      without a token returns 401)

## 2. Boot the stack

```bash
docker compose up --build -d
docker compose ps
```

- [ ] All seven containers (`postgres`, `redis`, `rabbitmq`,
      `user-service`, `order-service`, `payment-service`, `api-gateway`)
      show as `running`, and the ones with a healthcheck show `healthy`
      (give it 30–60s on first boot — Postgres and RabbitMQ need to
      initialize before the app containers' healthchecks turn green).
- [ ] `docker compose logs` shows no repeating crash/restart loop for any
      service.

## 3. Health endpoints

```bash
curl -s http://localhost:3000/health   # api-gateway
curl -s http://localhost:3001/health   # user-service
curl -s http://localhost:3002/health   # order-service
curl -s http://localhost:3003/health   # payment-service
```

- [ ] All four return `HTTP 200` with `"status":"ok"`.
- [ ] `user-service` and `payment-service` health responses include
      `"database":{"status":"up"}`.
- [ ] `order-service`'s health response includes both `"database"` and
      `"redis"` as `"up"`.
- [ ] RabbitMQ's management UI loads at http://localhost:15672
      (`fooduser` / `foodpass`) and **Queues** lists exactly five:
      `user_queue`, `order_queue`, `payment_queue`, `order_events_queue`,
      `payment_events_queue` — each with 1 consumer.

## 4. Functional flow (happy path)

Automated by `scripts/health-check.sh`. To do it by hand:

- [ ] `POST /auth/register` with a new email → `201`, body has no
      `passwordHash` field.
- [ ] `POST /auth/login` with the same credentials → `200`, body has an
      `accessToken`.
- [ ] `POST /orders` (with `Authorization: Bearer <token>`) → `201`,
      `status` is `PENDING`.
- [ ] `GET /orders/:id` a second or two later → `status` has become
      `CONFIRMED` (or, rarely — the simulated payment gateway fails ~20%
      of the time per attempt and there are 3 attempts, so about 1 in 125
      orders — `FAILED`; either is a *terminal* status and proves the
      async pipeline ran. Only a status still stuck on `PENDING` after a
      few seconds indicates a real problem).
- [ ] `GET /payments/order/:id` → `200`, a payment record exists with a
      matching `orderId`.
- [ ] `GET /orders` → the new order appears in the list.
- [ ] *(optional, deeper check)* `docker compose exec redis redis-cli GET
      order:<id>` returns the cached order JSON with the confirmed status.

## 5. Negative / edge paths

Also automated by the script. By hand:

- [ ] Registering the same email twice → second call is `409`.
- [ ] Logging in with the wrong password → `401`.
- [ ] Registering with an invalid email / short password → `400`, with a
      `message` array naming which fields failed.
- [ ] `GET /orders` with no `Authorization` header → `401`.
- [ ] `GET /orders` with a garbage bearer token → `401`.
- [ ] A second user's token used against the first user's `GET
      /orders/:id` → `403`.
- [ ] `GET /orders/<a made-up uuid>` → `404`.

## 6. Automated shortcut

```bash
./scripts/health-check.sh
```

- [ ] Every line prints `PASS`; the summary reads `20 passed, 0 failed`;
      exit code is `0` (`echo $?` right after).

Point it at a non-default host/port with `BASE_URL=... USER_HEALTH=...
ORDER_HEALTH=... PAYMENT_HEALTH=... ./scripts/health-check.sh` if you're
not using the default Docker Compose ports.

## 7. CI/CD (after pushing to your own GitHub)

- [ ] The **Actions** tab shows the `CI` workflow running on push.
- [ ] The `test` job is green for all four services (lint + unit tests +
      build).
- [ ] The `docker-build` job is green for all four services.
- [ ] On `main` only: the `publish` job is green and four packages show up
      under the repo's **Packages** sidebar (`food-delivery-api-gateway`,
      etc). If `publish` fails with a permissions error, go to **Settings
      → Actions → General → Workflow permissions** and enable "Read and
      write permissions" — GitHub Container Registry pushes need it, and
      it's off by default on new repos.

## 8. Cleanup

```bash
docker compose down -v
```

- [ ] Containers stop and the Postgres volume is removed — `docker compose
      ps` shows nothing, `docker volume ls` no longer lists this project's
      volume.

---

Found a gap between what's checked here and what actually happened? That's
worth fixing in the code, not just the checklist — see
[ARCHITECTURE.md](./ARCHITECTURE.md#next-steps-for-a-production-deployment)
for known limitations that are already tracked rather than silently
missing.
