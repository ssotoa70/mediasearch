# Contributing to MediaSearch

Thank you for your interest in contributing to MediaSearch! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `pnpm install`
4. Start local infrastructure: `docker compose up -d`
5. Build packages: `pnpm build`
6. Run tests: `pnpm test`

## Development Workflow

### Branch Naming

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or fixes

### Commit Messages

Use conventional commits format:

```
type(scope): description

[optional body]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(search): add hybrid search support`
- `fix(ingest): handle missing etag in S3 events`
- `docs(readme): update configuration section`

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure all tests pass: `pnpm test`
4. Ensure type checking passes: `pnpm typecheck`
5. Update documentation if needed
6. Submit a pull request with a clear description

## Architecture Guidelines

### Adapter Pattern

All infrastructure dependencies must go through port interfaces:

- `DatabasePort` - Database operations
- `QueuePort` - Job queue operations
- `StoragePort` - Object storage operations
- `ASRPort` - Speech recognition
- `EmbeddingPort` - Vector embeddings

### Adding New Adapters

1. Implement the port interface in `packages/adapters/`
2. Add factory function with environment configuration
3. Update adapter selection in service files
4. Add documentation in `docs/`

### Service Guidelines

- Services should be stateless
- Use dependency injection for adapters
- Include health check endpoints
- Log meaningful events (not noise)

## Testing

### Unit Tests

Located in each package. Run with:
```bash
pnpm test:unit
```

### Integration Tests

Located in `test/integration/`. Require running infrastructure:
```bash
docker compose up -d
pnpm test:integration
```

## Documentation

- Update `README.md` for user-facing changes
- Update `docs/` for architectural changes
- Include JSDoc comments for public APIs

## Questions?

Open an issue for questions or discussions about contributions.
