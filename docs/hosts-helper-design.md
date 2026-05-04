# Betty Hosts Helper Design

## Goal

Build a privileged helper for hosts-file updates so the main Betty CLI can stay unprivileged while still supporting non-`.localhost` domains safely.

## Problem Statement

Current hosts updates require elevated privileges (`sudo`/UAC prompt) at runtime. This causes repeated friction and can block automation.

## Non-Goals

- No generic root shell execution.
- No plugin/runtime script execution in privileged context.
- No broad filesystem permissions beyond hosts-file operations.

## Design Principles

- Least privilege: helper can only perform hosts operations.
- Narrow API: validated structured input, no raw command strings.
- Idempotent behavior: repeated calls do not duplicate entries.
- Explicit ownership: Betty only edits entries it created.
- Cross-platform parity: Linux/macOS/Windows behavior aligned where possible.

## High-Level Architecture

1. `betty` (user process) performs validation and computes desired state.
2. `betty-hosts-helper` (privileged process) performs write/remove operations.
3. Communication is request/response with JSON payloads over stdin/stdout.
4. Helper supports only 3 commands: `ensure`, `remove`, `list-owned`.

## Helper Binary Scope

Allowed:

- Read hosts file.
- Append/update/remove Betty-owned hosts lines.
- Return structured status and diagnostics.

Forbidden:

- Arbitrary file writes.
- Command execution from input.
- Network access requirements.

## Data Model

### Ownership Marker

Each managed line uses a canonical marker:

`127.0.0.1 myapp.dev # betty:managed`

Optional metadata marker for future migration:

`# betty:managed v1`

### Request Schema

```json
{
  "version": 1,
  "command": "ensure",
  "entries": [
    { "ip": "127.0.0.1", "domain": "myapp.dev" }
  ]
}
```

### Response Schema

```json
{
  "ok": true,
  "changed": true,
  "applied": ["127.0.0.1 myapp.dev"],
  "warnings": []
}
```

## Validation Rules

- Domains must be FQDN-like labels (`a-z`, `0-9`, `-`, `.`), lowercased.
- Reject whitespace/control chars and shell metacharacters.
- Restrict to IPv4 `127.0.0.1` in phase 1.
- Reject duplicate domains in a single request.
- Optional allowlist policy for suffixes (e.g. `.dev`, `.test`, `.local`, `.localhost`).

## OS-Specific Strategy

### Linux/macOS

- Install helper to a fixed location (e.g. `/usr/local/lib/betty/betty-hosts-helper`).
- `betty setup --install-helper` performs one-time elevated installation.
- Grant execute permissions only to owner/root as needed.
- Use one of:

  - `sudoers` rule for exact helper path with constrained args, or
  - setuid-root helper (only after security review; sudoers preferred first).

### Windows

- Install helper executable under Program Files.
- Register helper for elevation path (UAC) once in setup.
- Main CLI calls helper via a controlled launcher API.
- Helper writes only `%SystemRoot%\\System32\\drivers\\etc\\hosts`.

## File Update Algorithm

1. Read hosts file as text.
2. Parse lines preserving unknown content and comments.
3. Detect Betty-managed entries by marker.
4. For `ensure`:
   - Add missing managed lines.
   - Update stale Betty-managed lines for same domain.
   - Leave non-Betty lines untouched.
5. For `remove`:
   - Remove only Betty-managed lines matching requested domain(s).
6. Write atomically:
   - write temp file in same directory,
   - fsync,
   - replace original.
7. Verify by re-read and return `changed` status.

## CLI Integration

### New Setup Actions

- `betty setup --install-helper`
- `betty setup --helper-status`

### Runtime Flow

- `link/relink/unlink` calls helper only when domain is not `.localhost`.
- If helper unavailable:

  - print actionable warning,
  - continue where possible,
  - keep `.localhost` recommendation.

## Security Controls

- Hardcoded hosts path per OS.
- Strict JSON schema validation in helper.
- No interpolation into shell commands.
- Detailed exit codes and non-sensitive logs.
- Optional request audit log (domain, operation, timestamp; no secrets).

## Migration Plan

### Phase 1 (safe baseline)

- Keep current behavior by default.
- Add helper code path behind feature flag:

  - `BETTY_HOSTS_HELPER=1`

- Add tests for parser and ownership marker behavior.

### Phase 2 (opt-in)

- `betty setup --install-helper` documented and encouraged.
- CLI prefers helper path when installed.

### Phase 3 (default)

- Helper path becomes default for non-`.localhost` domains.
- Legacy direct append path kept as fallback for one release cycle.

## Test Strategy

### Unit Tests

- Domain validation edge cases.
- Hosts parser/serializer roundtrip.
- Ensure/remove idempotency.
- Ownership isolation (never remove non-Betty lines).

### Integration Tests

- Temp hosts file fixtures on Linux runner.
- Simulated helper request/response contract.
- Failure injection (permission denied, malformed file, partial writes).

### Platform Tests

- Windows CI smoke for helper invocation path.
- Linux/macOS helper install and call path.

## Rollback Plan

- Disable helper via env/config switch.
- Revert to current manual/elevated fallback path.
- Keep parser independent from helper to avoid data loss risk.

## Open Decisions

1. Linux/macOS privilege model: `sudoers` constrained rule vs setuid helper.
2. Suffix allowlist policy strictness by default.
3. Whether to include IPv6 localhost (`::1`) in phase 1 or later.

## Suggested Next Implementation Tasks

1. Add request/response TypeScript interfaces under `src/types`.
2. Build pure hosts parser module with full tests.
3. Implement helper binary skeleton with stdin/stdout JSON protocol.
4. Add `setup --install-helper` command path.
5. Wire `link/relink/unlink` to helper behind feature flag.
6. Add docs section: helper security model and setup instructions.
