#!/usr/bin/env bash
# End-to-end test against real Docker, mkcert and Traefik. The unit tests mock
# docker and the file system; this runs the built CLI the way a user does and
# checks what a browser or psql would actually get.
#
# Needs: a built bin/, Docker, mkcert, curl, passwordless sudo (hosts file),
# and free ports 80/443. It changes the hosts file, ~/.betty and the mkcert
# trust store, so run it in CI or a throwaway VM, not on a workstation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
WHOAMI=traefik/whoami:v1.10
POSTGRES=postgres:17-alpine
CONTAINERS=(betty-e2e-one betty-e2e-two betty-e2e-proj betty-e2e-db)

# A timeout, so a command that waits for input fails with a log instead of
# hanging the job.
betty() { timeout 180 node "$ROOT/bin/betty.js" "$@" </dev/null; }
step() { printf '\n=== %s\n' "$*"; }
fail() { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  betty rest --yes >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

CA="$(mkcert -CAROOT)/rootCA.pem"

# Retries while Traefik reloads its routes after a restart.
expect_backend() {
  local url=$1 backend=$2 body=''
  for _ in $(seq 1 30); do
    body="$(curl -fsS --max-time 5 --cacert "$CA" "$url" 2>/dev/null || true)"
    if grep -q "^Hostname: $backend\$" <<<"$body"; then echo "ok: $url -> $backend"; return 0; fi
    sleep 1
  done
  fail "$url did not reach $backend. Last response: ${body:-<none>}"
}

expect_unreachable() {
  local url=$1
  for _ in $(seq 1 30); do
    if ! curl -fsS --max-time 5 --cacert "$CA" "$url" >/dev/null 2>&1; then echo "ok: $url is gone"; return 0; fi
    sleep 1
  done
  fail "$url still answers"
}

expect_hosts() {
  if grep -qE "^127\.0\.0\.1[[:space:]]+$1([[:space:]]|\$)" /etc/hosts; then echo "ok: hosts has $1"; else fail "hosts has no entry for $1"; fi
}

expect_no_hosts() {
  if grep -qE "[[:space:]]$1([[:space:]]|\$)" /etc/hosts; then fail "hosts still has $1"; else echo "ok: hosts has no $1"; fi
}

step 'Start two backends'
docker run -d --name betty-e2e-one --hostname e2e-one "$WHOAMI" >/dev/null
docker run -d --name betty-e2e-two --hostname e2e-two "$WHOAMI" >/dev/null

step 'betty serve'
betty serve
docker inspect -f '{{.State.Running}}' betty-traefik | grep -q true || fail 'betty-traefik is not running'

step 'betty link: a .test domain gets HTTPS and a hosts entry'
betty link betty-e2e-one --domain one.e2e.test --yes
expect_hosts one.e2e.test
expect_backend https://one.e2e.test e2e-one

step 'betty link: a .localhost domain needs no hosts entry'
betty link betty-e2e-two --domain two.localhost --port 80 --yes
expect_no_hosts two.localhost
expect_backend https://two.localhost e2e-two

step 'betty status --json lists both links'
betty status --json >"$WORK/status.json"
for domain in one.e2e.test two.localhost; do
  grep -q "\"$domain\"" "$WORK/status.json" || { cat "$WORK/status.json"; fail "status --json misses $domain"; }
done

step 'betty relink: move a domain to another container'
betty relink one.e2e.test --container betty-e2e-two --yes
expect_backend https://one.e2e.test e2e-two

step 'betty relink: rename the domain'
betty relink one.e2e.test --domain uno.e2e.test --yes
expect_backend https://uno.e2e.test e2e-two
expect_no_hosts one.e2e.test
expect_unreachable https://one.e2e.test

step 'betty project load: an HTTP app and a postgres database'
mkdir -p "$WORK/project"
cat >"$WORK/project/.betty.yml" <<EOF
project: betty-e2e
up:
  command: >-
    docker run -d --name betty-e2e-proj --hostname e2e-proj -p 18080:80 $WHOAMI &&
    docker run -d --name betty-e2e-db -e POSTGRES_PASSWORD=e2e -p 15432:5432 $POSTGRES
down:
  command: docker rm -f betty-e2e-proj betty-e2e-db
domains:
  - host: proj.e2e.test
    target: http://127.0.0.1:18080
  - host: db.e2e.test
    target: postgres://127.0.0.1:15432
https:
  enabled: true
  certificateAuthority: missbetty
permissions:
  hosts: allowed
  trustStore: allowed
  docker: allowed
EOF
(cd "$WORK/project" && betty project load --yes)
expect_hosts proj.e2e.test
expect_hosts db.e2e.test
expect_backend https://proj.e2e.test e2e-proj

# psql 17 for sslnegotiation=direct, which Traefik's HostSNI routing needs.
# A container of its own has its own hosts file, hence --add-host.
query=''
for _ in $(seq 1 15); do
  query="$(timeout 20 docker run --rm --network host --add-host db.e2e.test:127.0.0.1 \
    -v "$(dirname "$CA"):/ca:ro" -e PGPASSWORD=e2e -e PGCONNECT_TIMEOUT=5 "$POSTGRES" \
    psql "postgresql://postgres@db.e2e.test:443/postgres?sslmode=verify-full&sslnegotiation=direct&sslrootcert=/ca/rootCA.pem" \
    -tAc 'select 40 + 2' 2>&1 || true)"
  [ "$query" = '42' ] && break
  sleep 1
done
[ "$query" = '42' ] || { docker logs --tail 50 betty-traefik; cat ~/.betty/dynamic/betty-e2e.yml; fail "psql through db.e2e.test failed: $query"; }
echo 'ok: psql through db.e2e.test'

step 'betty project stop'
(cd "$WORK/project" && betty project stop --yes)
expect_no_hosts proj.e2e.test
expect_no_hosts db.e2e.test
expect_unreachable https://proj.e2e.test
if docker inspect betty-e2e-proj >/dev/null 2>&1; then fail 'the down command did not run'; fi

step 'betty unlink'
betty unlink uno.e2e.test --yes
betty unlink two.localhost --yes
expect_no_hosts uno.e2e.test
expect_unreachable https://uno.e2e.test
expect_unreachable https://two.localhost
if grep -q 'added by betty' /etc/hosts; then grep 'added by betty' /etc/hosts; fail 'betty left hosts entries behind'; fi

step 'betty rest'
betty rest --yes
if docker inspect betty-traefik >/dev/null 2>&1; then fail 'betty-traefik still exists'; fi

printf '\nAll end-to-end checks passed.\n'
