# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

## [0.1.0] - 2025-01-08

Initial release of MediaSearch - a media transcription, indexing, and search platform for VAST Data infrastructure.

### Added

#### Core Architecture
- **Domain layer** with business logic, entity types, and port interfaces
- **Adapter pattern** for swappable infrastructure implementations
- Lifecycle management with visibility states (STAGING → ACTIVE → ARCHIVED → SOFT_DELETED)
- Idempotent operations with exponential backoff retry logic

#### Services
- **Ingest Service**: S3 bucket notification handler for media file ingestion
- **Orchestrator Service**: Job processing pipeline for ASR and embedding generation
- **Search API**: Keyword, semantic, and hybrid search with metadata filtering
- **Triage Service**: Dead-letter queue management and quarantine handling
- **ASR Worker**: Standalone worker scaffold for transcription processing

#### Adapters
- **VAST DataBase adapter**: Production database with vector embedding support
- **VAST DataEngine adapter**: Production serverless compute adapter
- **Local PostgreSQL adapter**: Development database with pgvector
- **Local Queue adapter**: Development queue using Redis/BullMQ
- **Local S3 adapter**: Development object storage using MinIO

#### Infrastructure
- Docker Compose configuration for local development stack
- Dockerfiles for all services
- Database migrations with schema versioning
- Environment configuration via `.env` files

#### Documentation
- Architecture overview with VAST-native design principles
- Local development guide
- VAST deployment guide
- API reference documentation
- Contributing guidelines

#### CI/CD
- GitHub Actions workflow for build, lint, typecheck, and test
- Dependency guardrail to prevent non-VAST infrastructure drift
- Docker build verification (non-blocking)
- Security audit (non-blocking)

### Non-Goals (Documented)
- No PostgreSQL in production (VAST DataBase only)
- No Redis/message queues in production (VAST DataEngine only)
- No external object stores (VAST S3-compatible storage only)

[Unreleased]: https://github.com/ssotoa70/mediasearch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ssotoa70/mediasearch/releases/tag/v0.1.0
