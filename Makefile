# mlx-hub Makefile
# ================
# Build and test automation for the MLX Hub Claude Code plugin

.PHONY: help install build test test-ts test-py test-watch typecheck clean all check-deps reset-python

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
	@echo "  test-ts      Run TypeScript tests only (117 tests)"
	@echo "  test-py      Run Python tests only (15 tests)"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean        Remove build artifacts"
	@echo "  reset-python Reset Python environment (forces reinstall)"
	@echo "  check-deps   Verify required tools are installed"
	@echo "  all          Full check: install, build, test"

# Install - now requires uv for Python environment management
# Python deps are auto-installed on first use via ~/.mlx-hub/venv/
install: build
	@echo "Build complete. Python environment will be auto-configured on first use."
	@echo "Note: Requires 'uv' - install with: brew install uv"

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
	@echo "All tests passed! (117 TS + 15 Python = 132 total)"

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

# Reset the Python environment - forces reinstall on next use
reset-python:
	@echo "Removing Python environment..."
	rm -rf ~/.mlx-hub/venv
	rm -f ~/.mlx-hub/.python-ready
	@echo "Python environment reset. Will be reinstalled on next use."

# Check if required dependencies are installed
check-deps:
	@command -v uv >/dev/null 2>&1 || { echo "Error: 'uv' is required. Install with: brew install uv"; exit 1; }
	@echo "All dependencies OK"

# Full check: install, build, and test
all: install build test
	@echo ""
	@echo "All checks passed!"
