SERVICES = api-gateway user-service order-service payment-service

.PHONY: install test test-e2e lint up down logs build build-ts restart ps

install:
	@for s in $(SERVICES); do \
		echo ">> installing $$s"; \
		(cd services/$$s && npm install) || exit 1; \
	done

test:
	@for s in $(SERVICES); do \
		echo ">> testing $$s"; \
		(cd services/$$s && npm test) || exit 1; \
	done

test-e2e:
	@echo ">> e2e testing api-gateway"
	@(cd services/api-gateway && npm run test:e2e) || exit 1

lint:
	@for s in $(SERVICES); do \
		echo ">> linting $$s"; \
		(cd services/$$s && npm run lint) || exit 1; \
	done

build-ts:
	@for s in $(SERVICES); do \
		echo ">> compiling $$s"; \
		(cd services/$$s && npm run build) || exit 1; \
	done

up:
	docker compose up --build -d

down:
	docker compose down -v

restart:
	docker compose restart

logs:
	docker compose logs -f

ps:
	docker compose ps

build:
	docker compose build
