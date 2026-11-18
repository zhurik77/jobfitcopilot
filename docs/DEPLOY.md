# Deployment Guide — Job Fit Copilot

This guide covers deploying the Job Fit Copilot server (MCP + REST API + panel) with Docker Compose, manual setup, environment variables, production considerations, and troubleshooting.

## Quick Start — Docker Compose

### Prerequisites
- Docker Engine 20.10+
- Docker Compose v2 (`docker compose` plugin)

### Run

```bash
docker compose up -d --build
```

The server starts on **http://localhost:3001** with:
- `GET /healthz` — liveness probe
- `POST /mcp` — Model Context Protocol endpoint
- `GET /api/*` — REST API
- `GET /` — static panel UI

Verify it is healthy:

```bash
curl -s http://localhost:3001/healthz
# {"ok":true,...}
```

Check container status:

```bash
docker compose ps
docker compose logs -f server
```

### Stop / reset

```bash
docker compose down          # stop and remove containers
docker compose down -v       # also delete the jobfit-data volume (SQLite DB!)
```

## Manual Setup (without Docker)

### Prerequisites
- Node.js >= 22

### Steps

```bash
cd server
npm ci
npm start        # runs: node src/index.js
```

The server listens on `0.0.0.0:3001` by default (configurable via `PORT` / `HOST` env vars). To run the test suite:

```bash
npm test
```

### Building the landing page (optional)

The marketing site builds from `site/` into `docs/` (GitHub Pages):

```bash
cd site
npm ci
npm run build:docs
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address; use `127.0.0.1` to restrict to loopback |
| `NODE_ENV` | `production` | Runtime mode |
| `DB_PATH` | `/data/jobfit.db` (Docker), `:memory:` (manual) | SQLite database file path; `:memory:` runs an ephemeral in-memory DB |
| `WEBBRIDGE_URL` | — | URL of the web bridge service (e.g. `http://host.docker.internal:10086`) |
| `CUSTOM_LLM_URL` | — | OpenAI-compatible LLM endpoint (e.g. `http://host.docker.internal:8000/v1`) |

### Accessing host services from inside Docker

On Linux, `host.docker.internal` is not available by default. The Compose file's `extra_hosts` entry (`host-gateway`) maps it automatically. If you need to reach services running on the Docker host (LLM, web bridge), set:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

## Production Considerations

### Security
- **Bind to loopback** if the panel/MCP API must not be reachable from the network: change ports mapping to `"127.0.0.1:3001:3001"`.
- **Do not expose `DB_PATH` volume** to untrusted hosts; the SQLite file contains all parsed vacancies, resumes, and scores.
- The server sends security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`) and applies an in-memory rate limit (100 req/min/IP).
- Run behind a reverse proxy (nginx/Caddy/Traefik) for TLS termination, request size limits, and real client IPs.

### Persistence
- SQLite data lives in the named volume `jobfit-data`. Back it up regularly:

```bash
docker run --rm -v jobfit-data:/data -v $(pwd):/backup alpine \
  sh -c "cp /data/jobfit.db /backup/jobfit-$(date +%F).db"
```

### Resource limits

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
```

### Health checks
- Docker `HEALTHCHECK` polls `/healthz` every 30s (5s timeout, 3 retries, 10s start period).
- Orchestrators (Kubernetes, Swarm) should use the same endpoint for liveness/readiness probes.

### Updating

```bash
git pull
docker compose up -d --build
```

Alternatively, pull the published image from GHCR (built by `.github/workflows/docker-publish.yml` on every release):

```bash
docker pull ghcr.io/<owner>/jobfitcopilot:latest
```

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `port is already allocated` | Another process uses 3001. Change the host port: `"3002:3001"` or stop the conflicting service. |
| Container is `unhealthy` | `docker compose logs server` — usually a crashed DB (check `DB_PATH` volume permissions) or a port conflict inside the container. |
| Panel loads but API returns 500 | Check logs for `request_error` entries with `requestId`; verify `DB_PATH` is writable. |
| LLM / web bridge unreachable from container | Use `host.docker.internal` with `extra_hosts: host-gateway` (Linux), or put services on the same Docker network. |
| `npm ci` fails in build | Ensure `server/package-lock.json` is committed and in sync with `package.json`. |
| Data lost after restart | You removed the volume (`docker compose down -v`) or `DB_PATH` points to `:memory:`. |
| Permission denied writing `/data` | The image runs as user `node`; ensure the volume is not owned by root (the Dockerfile pre-creates `/data` with correct ownership). |
| Slow first build | Multi-platform builds (amd64+arm64) in CI use QEMU. Locally, build only for your platform: `docker build --platform linux/amd64 -f server/Dockerfile .` |

### Useful commands

```bash
docker compose exec server wget -qO- http://127.0.0.1:3001/healthz   # in-container health check
docker compose logs --tail 100 server                                # recent logs
docker compose exec server node --test                               # run tests inside the image
docker system prune -f                                               # reclaim build cache/dangling layers
```
