SHELL := /bin/sh
.DEFAULT_GOAL := help

APP_NAME ?= ocr-app
COMPOSE ?= docker compose

.PHONY: help install build dev up down

help: ## Recap available commands
	@printf "Usage: make <target>\n\n"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies and create .env from .env.example (if missing)
	@if [ ! -f .env ] && [ -f .env.example ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	bun install

build: ## Build Docker image and compose service
	docker build -t $(APP_NAME) .
	$(COMPOSE) build

dev: ## Run app locally with Bun (no Docker)
	bun run dev

up: ## Start app in Docker Compose (detached)
	$(COMPOSE) up -d

down: ## Stop app and remove compose resources
	$(COMPOSE) down
