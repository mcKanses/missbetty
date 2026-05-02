# Betty

Betty is a lightweight CLI for local Docker development domains.

The name is inspired by a 1950s telephone switchboard operator: Betty does not
become your reverse proxy. She connects local domains to running containers and
keeps the global proxy infrastructure out of individual projects.

Betty currently orchestrates:

- Docker
- Docker Compose
- one global Traefik proxy
- mkcert for local HTTPS certificates

## Status

Betty is an early prototype. The current goal is a small, Valet-like workflow:

```sh
betty serve
betty link
betty relink
betty status
betty unlink
betty rest
```

The core workflow does not require a project configuration file. Start your
containers with Docker or Docker Compose, then let Betty link them to local
domains.

## Requirements

- Node.js 20 or newer
- Docker with Docker Compose
- Access to the Docker socket
- mkcert for HTTPS support

On Linux, macOS, WSL, and devcontainers, Betty expects Docker commands such as
`docker ps` and `docker compose version` to work from the shell where Betty runs.

## Development Setup

```sh
git clone <repo-url>
cd getbetty.dev
npm install
npm run build
npm link
```

After `npm link`, the CLI is available as:

```sh
betty --help
```

## Devcontainer

This repository includes a devcontainer setup using Docker-outside-of-Docker.
That means Node and TypeScript run inside the devcontainer, while Docker
containers are created through the host Docker daemon.

This is suitable for CLI development and Docker orchestration tests. Host
browser access to custom domains may still require host-specific handling for
the hosts file.

## Commands

### `betty serve`

Starts Betty's global local switchboard service.

It creates:

- `~/.betty`
- `~/.betty/docker-compose.yml`
- `~/.betty/dynamic`
- `~/.betty/certs`
- Docker network `betty_proxy`
- Traefik container `betty-traefik`

Traefik publishes HTTPS on host port `443`. It still defines an internal HTTP
entrypoint for routing config compatibility, but Betty does not bind host port
`80`, so it can coexist with another local web server using port `80`.

Betty keeps its routing config globally in `~/.betty/dynamic`, and local
certificates in `~/.betty/certs`, so individual projects do not need
Betty-specific files.

### `betty rest`

Stops Betty's global local switchboard service.

It runs Docker Compose down against Betty's global compose file:

```sh
~/.betty/docker-compose.yml
```

### `betty status`

Shows Betty's proxy status and linked domains.

Useful options:

```sh
betty status --json
betty status --long
```

### `betty link`

Links a running container to a local domain.

If required values are missing, Betty asks interactively for:

- container
- domain
- internal container port

Betty connects the container to the global Docker network `betty_proxy`, writes
a route file to `~/.betty/dynamic`, and reloads the global Traefik container.
If mkcert is installed, Betty also creates a certificate in `~/.betty/certs`
and enables HTTPS for the linked domain.
For custom domains that are not under `.localhost`, Betty attempts to add a
single append-only hosts entry. `betty unlink` never removes or rewrites hosts
entries.

Use `.localhost` domains when possible, for example `my-app.localhost`.
Betty also accepts custom domains such as `.dev` and can add an append-only
hosts entry for them. Browsers require HTTPS for some TLDs, including `.dev`,
so mkcert should be installed before linking those domains.

Open linked domains with HTTPS when a certificate was created:

```txt
https://my-app.localhost
```

Example:

```sh
betty link
```

or:

```sh
betty link my-container --domain my-app.localhost --port 3000
```

### `betty unlink`

Removes an existing local domain link.

Example:

```sh
betty unlink --domain my-app.localhost
```

### `betty relink`

Updates an existing local domain link.

Use it when the container, domain, or internal port changes:

```sh
betty relink
betty relink my-app --port 5173
betty relink --domain my-app.example.dev
betty relink my-app.localhost --container new-container --port 3000
```

If values are missing, Betty asks interactively. When the domain changes to a
custom domain outside `.localhost`, Betty attempts to add a new append-only
hosts entry. It does not remove the previous hosts entry.

## Typical Workflow

Start Betty once:

```sh
betty serve
```

Start your application container with Docker or Docker Compose, then link it:

```sh
betty link
```

When you no longer need the global proxy:

```sh
betty rest
```

## Notes

Betty is not intended to replace Traefik, Caddy, nginx, or Docker Compose.
Instead, Betty provides a small CLI layer around them for local development.

Future work may include:

- better host file handling across Windows, WSL, Linux, and macOS
- cleaner persistent link state
- optional project discovery
