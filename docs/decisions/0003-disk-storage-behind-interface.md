# 0003 Disk storage behind an interface

Date: 2026-10-15
Status: accepted

## Context
The original spec used MinIO (S3-compatible object storage) for files. At our scale it is another service to run, secure and back up, and client data must stay on our own infrastructure.

## Decision
- Files go to a local disk volume (`/data/files`) behind a `Storage` interface: put, get, delete, signed URL.
- Thumbnails are made with sharp.
- MinIO is dropped.

## Consequences
- Fewer containers; files can be backed up by a volume copy (Phase 16).
- Feature code only sees the interface, so moving to S3-compatible storage later means writing one new implementation.
- Files are tied to one server's disk until that switch happens.
