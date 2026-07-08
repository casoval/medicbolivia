"""
app/db/activate_all_faqs.py
Utilidad puntual: activa (is_active=True) TODAS las FAQ existentes de una vez.

Solo hace falta si ya corriste seed_faqs.py cuando todavía creaba las
preguntas ocultas (is_active=False) y ahora querés publicarlas todas sin
entrar una por una al panel admin.

Uso:
    python -m app.db.activate_all_faqs
"""
import asyncio
from sqlalchemy import update

from app.db.database import AsyncSessionLocal
from app.models.models import FAQ


async def activate_all_faqs() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(FAQ).where(FAQ.is_active == False).values(is_active=True)  # noqa: E712
        )
        await db.commit()
        print(f"✅ {result.rowcount} preguntas activadas. Ya son visibles en la landing pública.")


if __name__ == "__main__":
    asyncio.run(activate_all_faqs())
