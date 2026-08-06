"""profile field visibility toggles + cleanup del 0 fantasma en años de experiencia

Tres cambios sobre los campos "verificables" del perfil del profesional
(años de experiencia, universidad, matrícula profesional):

1) Limpieza de datos: antes de esta migración, `years_experience` era
   NOT NULL a nivel de BD y ningún endpoint lo pasaba explícitamente al
   registrar un profesional, así que el ORM insertaba 0 por defecto en
   silencio. Ese 0 nunca fue un dato real ingresado por nadie — solo
   quedaba oculto al paciente porque `years_experience_verified` nace en
   False. Como a la fecha NINGÚN profesional tiene este campo verificado
   todavía (nadie perdió visibilidad real), es seguro volver a NULL el
   valor de cualquiera que no esté verificado, para que el profesional
   vea su propio formulario vacío en vez de un "0" que nunca escribió.

2) `years_experience_visible` y `university_visible`: el profesional
   puede ahora ocultar del paciente un dato ya verificado (sin borrarlo
   ni perder la verificación). Nacen en True para no cambiarle nada a
   quien ya estuviera verificado. `professional_license_number` no
   necesita esta bandera — al dejar de poder editarse (ver punto 3, a
   nivel de aplicación, no de esquema) siempre se muestra si está
   verificado, igual que antes.

3) `university` y `professional_license_number` pasan a ser de una sola
   edición por parte del profesional (dato que no cambia con el tiempo)
   — esa regla se aplica en el endpoint (PATCH /professionals/profile),
   no requiere cambio de esquema.

Revision ID: z1a2b3c4d5e6
Revises: y9z0a1b2c3d4
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'z1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'y9z0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS years_experience_visible BOOLEAN NOT NULL DEFAULT TRUE
    """)
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS university_visible BOOLEAN NOT NULL DEFAULT TRUE
    """)

    # Ver punto 1 del docstring: solo toca a quienes NO están verificados,
    # así que nunca le quita a un paciente un dato que de verdad estaba
    # viendo.
    op.execute("""
        UPDATE professionals
        SET years_experience = NULL
        WHERE years_experience_verified = FALSE
    """)


def downgrade() -> None:
    # La limpieza de datos del punto 1 no es reversible (no hay forma de
    # distinguir, al revertir, cuáles 0 eran "reales" vs. fantasma) — el
    # downgrade solo revierte el esquema.
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS years_experience_visible")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS university_visible")
