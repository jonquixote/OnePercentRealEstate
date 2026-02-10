# Scraping Pipeline & Workflows

The platform relies on a distributed scraping architecture to keep property and rental data fresh.

## 🏗️ Pipeline Components

### 1. Scraper Service (`scraper`)

- **Language**: Python (FastAPI)
- **Role**: Primary crawler for new property listings.
- **Port**: `8001` (Internal `8000`)
- **Output**: Directly inserts new rows into the `listings` table.

### 2. n8n Automation Workflows

- **Host**: `https://n8n.octavo.press`
- **Port**: `5678`
- **Role**: Handles complex, multi-step integrations that are easier to visualize in a flow.
- **Key Workflows**:
  - **Rental Data Fetch**: Periodically triggers a script to fetch nearby rental comps for properties marked "Calculating...".
  - **HUD API Sync**: Daily task to synchronize Fair Market Rent (FMR) data from HUD for target zip codes.

### 3. Database Triggers

- **Function**: `calculate_smart_rent(uuid)`
- **Behavior**: When a new listing is added, this function is automatically triggered. It calculates a "Smart Rent" using local comps and HUD data, updating the `estimated_rent` column.

## 🔄 The "Calculating..." State

Properties appear as "Calculating..." on the frontend when `estimated_rent` is `NULL` or `0`.

- The **n8n Workflow** is responsible for scanning the database for these rows.
- It calls the internal `/api/scrape` or `/api/estimate-rent` endpoint to populate the data.

## 🛠️ Monitoring Scrapers

To check if the scrapers are active:

### 1. Check logs on VPS

```bash
docker logs --tail 100 scraper
```

### 2. Monitor n8n executions

Navigate to the n8n dashboard and check the **Executions** tab for the "Rental Comp Scraper" workflow.

### 3. Check DB Counts

```sql
SELECT count(*) FROM listings WHERE estimated_rent IS NULL;
```

If this count is high and not decreasing, the n8n worker might be stalled.
