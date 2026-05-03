---
name: betty-feature
description: Implement a new feature in the Betty CLI
agent: agent
---

You are implementing a feature for the Betty CLI.

## Context

Betty links running Docker containers to local development domains with one
global Traefik proxy. The normal workflow should stay zero-config and
developer-friendly.

## Task

${input:feature:Describe the feature}

## Requirements

- Keep the CLI simple.
- Preserve the existing command surface unless a change is explicitly requested.
- Avoid unnecessary config files.
- Preserve cross-platform compatibility across Windows, WSL, Linux, and macOS.
- Avoid heavy dependencies.
- Prefer `.localhost` examples.
- Keep Docker integration practical and non-invasive.

## Output

1. Implementation
2. Explanation
3. Edge cases
4. Suggested follow-up improvements

## Verification

Run the relevant checks when feasible:

```sh
npm run build
npm run lint
npm test
```
