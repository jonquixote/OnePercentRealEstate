"""conftest for test_normalize — mocks homeharvest before scraper imports."""
import sys
import types

# Create a stub for homeharvest so scraper.py can import
hh_stub = types.ModuleType("homeharvest")
hh_stub.scrape_property = lambda **kwargs: None  # never called in tests
sys.modules.setdefault("homeharvest", hh_stub)

# Also stub psycopg2 since scraper imports it at module level
psycopg2_stub = types.ModuleType("psycopg2")
psycopg2_stub.connect = lambda *a, **kw: None
extras_stub = types.ModuleType("psycopg2.extras")
extras_stub.Json = lambda x: x
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", extras_stub)

# Stub dotenv
dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *a, **kw: None
sys.modules.setdefault("dotenv", dotenv_stub)
