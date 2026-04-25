# Deployment Notes

We are intentionally not deploying yet. Keep this as the checklist for the final push after the demo is polished.

## Vultr Target Shape

- Runtime: Node 20+
- Start command: `npm start`
- Port: `5173` or platform-provided `PORT`
- Environment variables:
  - `MONGODB_URI`
  - `MONGODB_DB`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `GITHUB_TOKEN`

## Pre-Deploy Checklist

1. Verify the local demo path end to end.
2. Verify Chrome extension sends traces to the target API URL.
3. Set MongoDB Atlas network access and credentials.
4. Set only the secrets needed for the demo.
5. Run `npm start`.
6. Check `/api/health`.

## Health Check

```text
GET /api/health
```

Expected local fallback:

```json
{
  "ok": true,
  "storage": "json",
  "database": "local-json"
}
```

Expected Atlas-backed run:

```json
{
  "ok": true,
  "storage": "mongodb",
  "database": "flowguard"
}
```
