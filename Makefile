.PHONY: run test desktop lint

run:
	docker compose up

test:
	docker compose run --rm test

desktop:
	cd crates/terminal-app && cargo tauri dev

lint:
	cd frontend && npx tsc --noEmit --skipLibCheck && npm run build
