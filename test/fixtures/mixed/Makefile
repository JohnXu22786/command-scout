# Mixed demo project used by the collector tests.
.PHONY: build clean

VERSION ?= 1.0.0
CC := gcc

build: clean ## Compile the release bundle
	@echo "building $(VERSION)"
	$(CC) -o app main.c

clean: ## Remove build artifacts
	rm -rf dist

test: ## Run the test suite
	pytest tests/

%.o: %.c
	$(CC) -c $<

lint:
	@echo linting
