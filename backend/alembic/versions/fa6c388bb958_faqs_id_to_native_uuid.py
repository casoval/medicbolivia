"""faqs_id_to_native_uuid

Bug detectado ago-2026: la tabla `faqs` es la única del sistema con `id`
tipado como `character varying` en la base real, mientras el modelo
SQLAlchemy (y las ~35 tablas restantes del proyecto) usan
UUID(as_uuid=False) — uuid nativo de Postgres. Esa desincronización nunca
se manifestó porque hasta ahora nunca se hizo un UPDATE ni un WHERE por
FAQ.id: apareció recién al convertir seed_faqs.py de insert-only a
upsert, y afecta también a los endpoints de editar/borrar FAQ del panel
admin (backend/app/api/v1/endpoints/faq.py líneas 113 y 144), que
probablemente vienen fallando con 500 desde que existe la tabla.

Verificado antes de este cambio: no hay ninguna FK apuntando a faqs.id
(tabla suelta, sin relaciones), y todas las filas existentes tienen un
id con formato UUID válido, así que el cast USING id::uuid no falla en
ninguna fila (confirmado en producción antes de escribir esta migración).

Revision ID: fa6c388bb958
Revises: f7a8b9c0d1e2
Create Date: 2026-08-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa6c388bb958'
down_revision: Union[str, Sequence[str], None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE faqs
        ALTER COLUMN id TYPE uuid USING id::uuid
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE faqs
        ALTER COLUMN id TYPE varchar USING id::varchar
    """)