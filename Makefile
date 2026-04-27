.PHONY: help build test clean install

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

build: ## Build all binaries
	@echo "Building binaries..."
	@mkdir -p bin
	go build -o bin/t ./cmd/t
	go build -o bin/t-daemon ./cmd/t-daemon
	go build -o bin/t-server ./cmd/t-server
	@echo "Build complete: bin/t, bin/t-daemon, bin/t-server"

test: ## Run all tests with race detection
	go test ./... -race -count=1

clean: ## Remove build artifacts
	rm -rf bin/
	rm -f *.db

install: build ## Install binaries to ~/.local/bin
	@echo "Installing to ~/.local/bin..."
	@mkdir -p ~/.local/bin
	cp bin/t ~/.local/bin/
	cp bin/t-daemon ~/.local/bin/
	cp bin/t-server ~/.local/bin/
	@echo "Installed successfully"
