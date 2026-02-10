# Deployment Guide

The deployment process is automated using **Expect scripts** to handle SSH authentication and remote command execution.

## 🛠️ Deployment Scripts

Located in the project root:

- `deploy_fix.exp`: Standard script for pulling the latest code and rebuilding the `app` container.
- `restart_services.exp`: Safely restarts core services while excluding resource-heavy ones like `ollama`.
- `apply_phase3_sql.exp`: Runs SQL migrations on the remote database.

## 🚀 Execution Flow

To deploy a change:

1. **Commit & Push**:

   ```bash
   git add .
   git commit -m "Description of change"
   git push origin main
   ```

2. **Trigger Deployment**:

   ```bash
   expect deploy_fix.exp
   ```

## 📋 What the Deployment Script Does

1. Connects to the VPS via SSH.
2. Navigates to `/root/one-percent-scraper`.
3. Resets local changes and pulls from `main`.
4. Executes `docker compose up -d --build --no-deps app` in the `infrastructure/` directory.
5. Prunes old Docker images to save disk space.

## 🔧 Troubleshooting

- **Permission Denied**: Check if the SSH password in the `.exp` script matches the server.
- **Service Not Found**: Ensure the service name in `docker compose` matches the one in the script (currently `app`).
