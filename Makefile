.PHONY: help run stop desktop test test-rust test-frontend lint

help:
	@echo "Terminal Engine — Development Commands"
	@echo ""
	@echo "  make run            Start the daemon and frontend in development mode"
	@echo "  make stop           Stop the daemon"
	@echo "  make desktop        Build and run the native Tauri desktop app"
	@echo "  make test           Run all tests (Rust + frontend)"
	@echo "  make test-rust      Run Rust tests only"
	@echo "  make test-frontend  Run frontend tests only"
	@echo "  make lint           Run linters (cargo fmt, clippy, eslint)"
	@echo ""

run:
	./run.sh

stop:
	./run.sh stop

desktop:
	./release.sh

test: test-rust test-frontend

test-rust:
	docker compose run --rm --profile test test

test-frontend:
	cd frontend && npm test -- --run

lint:
	cargo fmt --check
	cargo clippy --all-targets --all-features
	cd frontend && npm run lint
