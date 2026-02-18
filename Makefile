SHELL := /usr/bin/env bash

.PHONY: help setup run doctor test ui-test desktop demo

help:
	@echo "Targets:"
	@echo "  make setup    - prepare local shell usage"
	@echo "  make run      - show CLI help"
	@echo "  make doctor   - run environment diagnostics"
	@echo "  make test     - run CLI smoke tests"
	@echo "  make desktop  - open native desktop GUI"
	@echo "  make ui-test  - run desktop UI smoke test"
	@echo "  make demo     - run a safe demo sequence"

setup:
	chmod +x bin/cc tests/smoke.sh tests/ui_smoke.py ui/app.py
	@echo 'Use in current shell:'
	@echo '  export PATH="$$PWD/bin:$$PATH"'

run:
	PATH="$$PWD/bin:$$PATH" cc --help

doctor:
	PATH="$$PWD/bin:$$PATH" cc doctor

test:
	bash tests/smoke.sh

ui-test:
	python3 tests/ui_smoke.py

desktop:
	python3 ui/app.py || (echo "" && echo "Desktop app falhou. Ver README (secção 'Erros comuns no make desktop')." && exit 1)

demo:
	PATH="$$PWD/bin:$$PATH" cc --help
	PATH="$$PWD/bin:$$PATH" cc review || true
