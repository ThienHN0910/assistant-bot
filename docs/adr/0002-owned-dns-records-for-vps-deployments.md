---
status: accepted
supersedes: ADR-0001 section 1
---

# Own one DNS record per VPS deployment

Each VPS deployment owns an explicit Cloudflare A record for its subdomain. This replaces the wildcard A record proposed in ADR-0001 because deleting one web must stop that hostname from resolving. A deployment stores the Cloudflare record ID and a random ownership marker in the record comment. The marker lets it recover from an API response lost after creation; existing records that the bot cannot prove it owns are never overwritten or deleted. Static sites have no application port, while Node backends keep a localhost-only port behind Nginx. There is currently no wildcard record in the zone, so no wildcard migration is required. Legacy port-only sites without DNS may be removed; legacy sites with unowned DNS require explicit reconciliation.
