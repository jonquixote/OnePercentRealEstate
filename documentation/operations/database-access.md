# Database Access & Management

This guide explains how to connect to the PostgreSQL/PostGIS database and perform common administrative tasks.

## 🔑 Connection Credentials

The database runs as a Docker container (`postgres`) on the VPS.

- **Host**: `157.245.184.89` (Production) or `localhost` (Local)
- **Port**: `5432`
- **Database**: `postgres`
- **User**: `postgres`
- **Password**: `root_password_change_me_please` (Check `docker-compose.yml` for overrides)

## 🖥️ Connecting via CLI (psql)

### From the VPS Terminal

```bash
docker exec -it postgres psql -U postgres
```

### From your local machine (if port 5432 is exposed)

```bash
psql -h 157.245.184.89 -U postgres -d postgres
```

## 📊 Connecting via GUI (DBeaver / TablePlus)

1. **Host**: `157.245.184.89`
2. **Port**: `5432`
3. **Database**: `postgres`
4. **Username**: `postgres`
5. **Password**: `root_password_change_me_please`
6. **SSH Tunnel (Recommended)**:
   - Use SSH Tunneling for better security.
   - SSH Host: `157.245.184.89`
   - SSH User: `root`

## 🛠️ Common Administrative Tasks

### 1. Check Table Sizes

```sql
SELECT relname AS "Table", pg_size_pretty(pg_total_relation_size(relid)) AS "Size"
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;
```

### 2. Verify MVT Function

```sql
-- List spatial functions
\df public.listings_mvt
```

### 3. Clear Listing Data (Development Only)

```sql
TRUNCATE TABLE listings RESTART IDENTITY;
```

### 4. Check Smart Rent Trigger

```sql
-- See if the trigger is enabled
SELECT trigger_name, event_manipulation, state 
FROM information_schema.triggers 
WHERE event_object_table = 'listings';
```
