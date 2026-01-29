#!/bin/bash
set -e

# Configuration
REMOTE_HOST="157.245.184.89"
REMOTE_USER="root"
# Note: You should set up SSH keys for passwordless login, otherwise you'll be prompted for the password multiple times.
# Password provided: appo0-buXbym-cijzy

REMOTE_DIR="/root/one-percent-scraper"

echo "Using remote host: $REMOTE_USER@$REMOTE_HOST"

# 1. SSH Configuration & Connection Check
echo "Checking SSH connection..."

# Function to check if passwordless access works
check_ssh() {
    ssh -o BatchMode=yes -o ConnectTimeout=5 $REMOTE_USER@$REMOTE_HOST "echo connection_ok" 2>/dev/null
}

if ! check_ssh; then
    echo "Passwordless login is not configured."
    echo "Attempting to fix automatically..."

    # Check if local SSH key exists
    if [ ! -f "$HOME/.ssh/id_rsa.pub" ] && [ ! -f "$HOME/.ssh/id_ed25519.pub" ]; then
        echo "No SSH key found. Generating one now..."
        ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519" -N ""
    fi

    echo "----------------------------------------------------------------"
    echo "Please enter the server password when prompted."
    echo "Password: appo0-buXbym-cijzy"
    echo "----------------------------------------------------------------"
    
    # Copy key to server
    if ! ssh-copy-id $REMOTE_USER@$REMOTE_HOST; then
        echo "Failed to copy SSH key. You may need to run this command manually:"
        echo "ssh-copy-id $REMOTE_USER@$REMOTE_HOST"
        exit 1
    fi
    
    # Final check
    if ! check_ssh; then
        echo "Passwordless login failed (your key likely has a passphrase)."
        echo "We will proceed, but you may need to enter your key passphrase for each step."
        
        # Verify connectivity interactively
        ssh -o ConnectTimeout=10 $REMOTE_USER@$REMOTE_HOST "echo connection_verified" || {
             echo "Still unable to connect. Aborting."
             exit 1
        }
    fi
    echo "Proceeding with deployment..."
fi

# 2. Install Docker if missing
echo "Checking for Docker..."
ssh $REMOTE_USER@$REMOTE_HOST "command -v docker >/dev/null 2>&1 || { 
    echo 'Installing Docker...'; 
    curl -fsSL https://get.docker.com -o get-docker.sh; 
    sh get-docker.sh; 
}"

# 3. Create remote directory
echo "Creating remote directory..."
ssh $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR/init-scripts"

# 4. Upload App & Configuration
echo "Syncing project files..."
rsync -av --exclude='node_modules' --exclude='.git' --exclude='.next' --exclude='venv' --exclude='.venv' --exclude='env' --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
    ./ $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

# 4.5. Create .env from .env.local
echo "Configuring environment..."
ssh $REMOTE_USER@$REMOTE_HOST "cd $REMOTE_DIR && cp .env.local .env"

# 5. Build and Deploy
echo "Deploying stack..."
ssh $REMOTE_USER@$REMOTE_HOST "cd $REMOTE_DIR && docker compose -f infrastructure/docker-compose.yml up -d --build"

echo "Deployment complete!"
echo "n8n should be running internally on port 5678."
echo "Please configure Nginx Proxy Manager at npm.octavo.press to point 'one.octavo.press' to IP $REMOTE_HOST Port 5678."
