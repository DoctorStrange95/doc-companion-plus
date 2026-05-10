"""Database engine + session for Supabase Postgres (Transaction Pooler)."""

import os
import uuid
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

load_dotenv(Path(__file__).parent / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
ASYNC_DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

# NOTE: Supabase Transaction Pooler (PgBouncer pool_mode=transaction) does NOT
# support server-side prepared statements that survive across transactions.
# We must (a) disable the asyncpg client-side statement cache,
# (b) randomize prepared-statement names so the server never sees a duplicate
#     across pooled backends, and
# (c) avoid SQLAlchemy connection reuse by using NullPool so every checkout
#     opens a fresh PgBouncer-brokered connection.
engine = create_async_engine(
    ASYNC_DATABASE_URL,
    poolclass=NullPool,
    pool_pre_ping=False,
    echo=False,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4().hex}__",
        "command_timeout": 30,
        "server_settings": {"jit": "off"},
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
