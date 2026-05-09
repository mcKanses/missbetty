# Betty AI Contract

This repo contains Betty, a CLI for local Docker development domains.

## Product Principles

- CLI first.
- Zero-config by default.
- Developer experience over flexibility.
- Simple solutions over clever abstractions.
- Preserve cross-platform behavior across Windows, WSL, Linux, and macOS.
- Avoid heavy dependencies unless they are clearly justified.
- Keep global proxy infrastructure out of individual projects.

## Current Command Model

The current workflow is:

```sh
betty serve
betty link
betty relink
betty status
betty unlink
betty stop
```

`betty rest` is a legacy alias for `betty stop`.

Do not document or implement a replacement command name without considering
backward compatibility.

## Architecture Rules

- Keep CLI parsing separate from command behavior.
- Keep route generation and persistent link state separate from system calls.
- Isolate Docker, filesystem, hosts, and process execution boundaries.
- Prefer focused helpers over broad service objects.
- Do not add a plugin system until there is a concrete extension need.

## Coding Rules

- Follow the existing TypeScript style.
- Prefer arrow functions over function declarations.
- Use `T[]` instead of `Array<T>`.
- Use `??` for nullable coalescing.
- Prefer explicit boolean and nullable checks.
- Keep comments for non-obvious logic only.
- Add focused tests for behavior changes.

## Commit Rules

- Use Conventional Commit prefixes such as `feat:`, `fix:`, `chore:`,
  `docs:`, `test:`, or `refactor:`.
- Start the commit subject after the colon with an uppercase letter.

## Safety Rules

- Do not rewrite hosts files destructively.
- Do not introduce breaking CLI changes without explaining the migration path.
- Do not require per-project Betty config for the normal workflow.
- Do not assume Docker is running without handling failure clearly.

## Verification

For code changes, run when feasible:

```sh
npm run build
npm run lint
npm test
```
