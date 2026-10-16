# 0018 Visible name Help, code name Spolu, and old-domain redirects

Date: 2026-10-16
Status: accepted

## Context
The owner renamed the product users see from "Spolu by eGrant" to "Help by eGrant" (2026-10-16) and moved it from `spolu.egrant.sk` to `help.egrant.sk`. Renaming every identifier (packages, modules, databases, Docker project and volumes, env variables, image, repository) would touch data on the server and every script for no user benefit. Old links (emails, bookmarks, the eGrant intake URL, installed PWAs) must keep working after the move.

## Decision
- Only visible text changes: the header wordmark (`app.name`, `app.fullName`), `index.html`, the PWA manifest, the push fallback title, every email and the SK/EN locales. Spolu stays the code name everywhere else, including ADR 0011's manifest example, which this ADR updates. The wording pattern is in [product/overview.md](../product/overview.md), "Naming".
- Old domains are an optional deploy variable `REDIRECT_DOMAINS` (space-separated). `scripts/deploy.sh` writes `redirects.caddy` from it (`caddy_redirects` in `scripts/lib.sh`, tested) and `deploy/Caddyfile` imports it: one site block for all old domains with `redir https://{$DOMAIN}{uri} permanent`; Caddy gets a certificate per name. Unset, the file holds only comments, so Caddy asks for no certificate for a placeholder name. A Caddy env placeholder in the site address was rejected: an empty value leaves a block with no address, and a dummy default would make Caddy request a certificate for a bogus name.
- Every deploy now runs `caddy reload` after `docker compose up`, because `up` does not restart Caddy when only its mounted files changed.

## Consequences
- Users sign in again and turn on push again on the new domain (cookies and push subscriptions are per origin); installed PWAs are reinstalled from the new address. See [runbooks/deploy.md](../runbooks/deploy.md), "Moving to a new domain".
- Docs keep saying "Spolu" for the system; product docs say once that users see "Help by eGrant".
- Removing an old domain is an empty `REDIRECT_DOMAINS` and a deploy.
