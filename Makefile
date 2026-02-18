SHELL := /usr/bin/env bash

.PHONY: help setup run doctor test demo

help:
	@echo "Targets:"
	@echo "  make setup   - prepare local shell usage"
	@echo "  make run     - show CLI help"
	@echo "  make doctor  - run environment diagnostics"
	@echo "  make test    - run smoke tests"
	@echo "  make demo    - run a safe demo sequence"

setup:
	chmod +x bin/cc tests/smoke.sh
	@echo 'Use in current shell:'
	@echo '  export PATH="$$PWD/bin:$$PATH"'

run:
	PATH="$$PWD/bin:$$PATH" cc --help

doctor:
	PATH="$$PWD/bin:$$PATH" cc doctor

test:
	bash tests/smoke.sh

demo:
	PATH="$$PWD/bin:$$PATH" cc --help
	PATH="$$PWD/bin:$$PATH" cc review || true
