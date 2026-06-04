# n8n credentials

Credential JSON files in this directory are **not tracked by git** (see
`.gitignore`). They contain plaintext passwords that n8n's `import:credentials`
CLI accepts at first-boot.

## Why this directory exists

n8n encrypts credentials at rest using `N8N_ENCRYPTION_KEY` from the environment.
For initial bootstrap, the workflow JSON requires credentials to exist by id —
we ship a one-shot import step that reads JSON from this directory.

## Adding a credential locally

1. Create the JSON file (do **not** commit). Example shape:
   ```json
   [
     {
       "id": "pR4wUtye9OhGE0WS",
       "name": "Postgres account",
       "type": "postgres",
       "data": {
         "host": "postgres",
         "port": 5432,
         "database": "postgres",
         "user": "n8n",
         "password": "REPLACE_WITH_REAL_VALUE"
       }
     }
   ]
   ```
2. Run the import inside the n8n container per
   `documentation/operations/vps_deployment_guide.md` → "n8n" section.
3. Delete the local JSON after import (n8n now owns the encrypted copy).

## Past leak

Prior to 2026-06-03 this directory contained `postgres.json` with a real
postgres password committed in plaintext at commit `d2d24dc`. The leak was
removed from the index but **the value remains in git history**. Treat the
following as compromised and rotate before redeploying any code that uses it:

- `n8n` Postgres role password (was set in container env + this file)

See `documentation/operations/wave-7-open-items.md` for the rotation checklist.

## Optional: purge history

```bash
git filter-repo --invert-paths --path infrastructure/n8n_credentials/postgres.json
git push --force-with-lease --all
git push --force-with-lease --tags
```

This rewrites every branch and tag — coordinate with everyone who has a clone
before doing this. Without history purge, the leaked credential can still be
recovered from `git log -p d2d24dc -- infrastructure/n8n_credentials/`.
