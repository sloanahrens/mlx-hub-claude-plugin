# mlx-hub Makefile
# ================
# Build and test automation for the MLX Hub Claude Code plugin

.PHONY: help install build test test-ts test-py test-watch typecheck clean all

# Default target
help:
	@echo "mlx-hub - Claude Code plugin for local ML inference"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup:"
	@echo "  install      Install Node and Python dependencies"
	@echo ""
	@echo "Development:"
	@echo "  build        Compile TypeScript to dist/"
	@echo "  typecheck    Type-check without emitting files"
	@echo "  test-watch   Run tests in watch mode"
	@echo ""
	@echo "Testing:"
	@echo "  test         Run all tests (TypeScript + Python)"
	@echo "  test-ts      Run TypeScript tests only (59 tests)"
	@echo "  test-py      Run Python tests only (23 tests)"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean        Remove build artifacts"
	@echo "  all          Full check: install, build, test"

# Install all dependencies
install:
	@echo "Installing Node dependencies..."
	npm install
	@echo "Installing Python dependencies..."
	pip3 install -q -r python/requirements.txt
	@echo "Dependencies installed."

# Build TypeScript
build:
	@echo "Building TypeScript..."
	npm run build
	@echo "Build complete: dist/"

# Type-check without emitting
typecheck:
	@echo "Type-checking..."
	npx tsc --noEmit
	@echo "Type-check passed."

# Run all tests
test: test-ts test-py
	@echo ""
	@echo "All tests passed! (59 TS + 23 Python = 82 total)"

# Run TypeScript tests only
test-ts:
	@echo "Running TypeScript tests..."
	npm test

# Run Python tests only
test-py:
	@echo "Running Python tests..."
	python3 -m unittest python/test_mlx_runner.py

# Watch mode for development
test-watch:
	npm run test:watch

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/
	@echo "Clean complete."

# Full check: install, build, and test
all: install build test
	@echo ""
	@echo "All checks passed!"
