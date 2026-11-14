.DEFAULT_GOAL := help

.PHONY: help test lint check debug release

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

test: ## Run unit tests
	./gradlew --no-daemon test

lint: ## Run Android lint
	./gradlew --no-daemon lint

check: ## Run tests, lint, and debug/release builds
	./gradlew --no-daemon test lint assembleDebug assembleRelease

debug: ## Build a debug APK
	./gradlew --no-daemon assembleDebug

release: ## Build a signed, versioned release APK and checksum
	./build-release.sh
