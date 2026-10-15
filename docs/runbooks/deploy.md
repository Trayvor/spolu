# Deploy

How to deploy a new version of Spolu to an environment.

> Full runbook to be written in Phase 1.

## Prod-like run on your machine

```bash
docker build -t spolu:local --build-arg APP_VERSION=local .
cp deploy/test.env.example deploy/.env   # then set IMAGE=spolu, TAG=local, DOMAIN=localhost, PUBLIC_URL=https://localhost and real-looking secrets
cd deploy && docker compose -p spolutest up -d --wait
curl -k https://localhost/api/health      # {"status":"ok","db":"ok","version":"local"}
docker compose -p spolutest down -v       # removes the throwaway volumes
```

