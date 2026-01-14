import os
from dotenv import load_dotenv

load_dotenv('backend/.env')
print("Available keys:", list(os.environ.keys()))

# Filter for relevant ones
relevant = [k for k in os.environ.keys() if 'SUPABASE' in k or 'DB' in k or 'POSTGRES' in k]
print("Relevant keys:", relevant)
