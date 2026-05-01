# Betty

Cross-Platform CLI-Tool für lokale Domains mit Docker Compose & Traefik

## Features
- Automatische Domain-Routing für Projekte
- Orchestriert Traefik, Docker Compose und später mkcert
- Einfache CLI-Befehle: `betty init`, `betty proxy up`, `betty up`

## Installation & Nutzung

```sh
git clone ...
npm install
npm run build
npx betty init
npx betty proxy up
npx betty up
```

## Beispiel-Konfiguration (`betty.yml`)

```yaml
domain: myproject.localhost
services:
  frontend:
    port: 3000
  backend:
    port: 3000
```
