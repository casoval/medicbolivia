"""
app/core/redis_client.py
Cliente Redis async, usado para rate limiting (ej. intentos de login).
"""
import redis.asyncio as redis
from app.core.config import settings

redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
