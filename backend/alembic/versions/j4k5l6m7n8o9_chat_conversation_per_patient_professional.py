"""chat_conversations: única por par paciente-profesional, no por consulta

Hasta ahora chat_conversations.consultation_id era UNIQUE, así que cada
consulta pagada creaba su propio hilo de chat — dos consultas entre el
mismo paciente y el mismo profesional (ej. una inmediata y luego una
agendada, o una de seguimiento) generaban dos conversaciones separadas
en la bandeja de Mensajes, con el historial de mensajes partido entre
ambas. Esto pasa a ser un solo hilo compartido por par paciente-
profesional, sin importar cuántas consultas hayan tenido.

Pasos:
1. Fusionar duplicados existentes: para cada par (patient_user_id,
   professional_user_id) con más de una fila en chat_conversations, se
   conserva la más antigua (canónica), se reasignan todos los
   chat_messages de las demás hacia la canónica, se recalcula su
   last_message_at/last_message_preview con el mensaje más reciente del
   grupo fusionado, su status/expires_at toma el más "abierto" del
   grupo, y las filas duplicadas se borran.
2. consultation_id deja de ser UNIQUE y pasa a nullable (ya no es dueña
   de la fila — ver comentario en el modelo). Su FK pasa de CASCADE a
   SET NULL para que borrar esa consulta puntual no se lleve puesto el
   hilo compartido ni el historial de las demás consultas del par.
3. Se agrega un UNIQUE nuevo sobre (patient_user_id, professional_user_id).

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa

revision = "j4k5l6m7n8o9"
down_revision = "i3j4k5l6m7n8"
branch_labels = None
depends_on = None


def _drop_constraint_on_column(table: str, column: str, kind: str) -> None:
    """Suelta la constraint del tipo pedido ('FOREIGN KEY' o 'UNIQUE') que
    involucra `column` en `table`, buscando su nombre real en
    information_schema en vez de asumirlo (mismo patrón que
    e2f3a4b5c6d7_fix_chat_uuid_columns.py)."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = :kind
              AND tc.table_name = :table
              AND kcu.column_name = :column
            """
        ),
        {"kind": kind, "table": table, "column": column},
    )
    type_map = {"FOREIGN KEY": "foreignkey", "UNIQUE": "unique"}
    for row in result:
        op.drop_constraint(row[0], table, type_=type_map[kind])


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Fusionar duplicados por par paciente-profesional -----------------
    dupe_pairs = bind.execute(
        sa.text(
            """
            SELECT patient_user_id, professional_user_id
            FROM chat_conversations
            GROUP BY patient_user_id, professional_user_id
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    for patient_user_id, professional_user_id in dupe_pairs:
        rows = bind.execute(
            sa.text(
                """
                SELECT id, status, expires_at, last_message_at, last_message_preview
                FROM chat_conversations
                WHERE patient_user_id = :p AND professional_user_id = :pro
                ORDER BY created_at ASC
                """
            ),
            {"p": patient_user_id, "pro": professional_user_id},
        ).fetchall()

        canonical_id = rows[0][0]
        duplicate_ids = [r[0] for r in rows[1:]]

        # Reasignar mensajes de los duplicados hacia el hilo canónico
        for dup_id in duplicate_ids:
            bind.execute(
                sa.text("UPDATE chat_messages SET conversation_id = :canon WHERE conversation_id = :dup"),
                {"canon": canonical_id, "dup": dup_id},
            )

        # Recalcular last_message_at/preview con el mensaje más reciente
        # del grupo ya fusionado (puede venir de cualquiera de las filas
        # originales, ahora todas apuntando a canonical_id)
        latest = bind.execute(
            sa.text(
                """
                SELECT content, created_at FROM chat_messages
                WHERE conversation_id = :canon
                ORDER BY created_at DESC LIMIT 1
                """
            ),
            {"canon": canonical_id},
        ).fetchone()
        if latest:
            bind.execute(
                sa.text(
                    "UPDATE chat_conversations SET last_message_at = :at, last_message_preview = :preview WHERE id = :canon"
                ),
                {"at": latest[1], "preview": (latest[0] or "")[:300], "canon": canonical_id},
            )

        # El status/expires_at del hilo fusionado toma el más "abierto":
        # si cualquiera de los duplicados estaba ACTIVE, el resultado
        # queda ACTIVE; el expires_at queda en el máximo (o NULL si
        # alguno estaba en null, o sea "sigue en curso").
        statuses = [r[1] for r in rows]
        expires_ats = [r[2] for r in rows]
        final_status = "ACTIVE" if "ACTIVE" in statuses else statuses[0]
        if any(e is None for e in expires_ats):
            final_expires_at = None
        else:
            final_expires_at = max(expires_ats)
        bind.execute(
            sa.text("UPDATE chat_conversations SET status = :status, expires_at = :expires_at WHERE id = :canon"),
            {"status": final_status, "expires_at": final_expires_at, "canon": canonical_id},
        )

        # Borrar las filas duplicadas (ya sin mensajes propios)
        for dup_id in duplicate_ids:
            bind.execute(sa.text("DELETE FROM chat_conversations WHERE id = :dup"), {"dup": dup_id})

    # 2) consultation_id deja de ser UNIQUE y de ser CASCADE ---------------
    _drop_constraint_on_column("chat_conversations", "consultation_id", "UNIQUE")
    _drop_constraint_on_column("chat_conversations", "consultation_id", "FOREIGN KEY")

    op.alter_column("chat_conversations", "consultation_id", existing_type=sa.String(), nullable=True)
    op.create_foreign_key(
        "chat_conversations_consultation_id_fkey",
        "chat_conversations", "consultations",
        ["consultation_id"], ["id"],
        ondelete="SET NULL",
    )

    # 3) Nuevo UNIQUE por par paciente-profesional --------------------------
    op.create_unique_constraint(
        "uq_chat_conversations_patient_professional",
        "chat_conversations",
        ["patient_user_id", "professional_user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_chat_conversations_patient_professional", "chat_conversations", type_="unique")
    _drop_constraint_on_column("chat_conversations", "consultation_id", "FOREIGN KEY")

    # No se puede recuperar los hilos fusionados como filas separadas
    # (se perdió qué mensaje pertenecía a cuál consulta original), así
    # que solo se revierte la forma de la columna. Cualquier fila sin
    # consultation_id (por SET NULL previo) rompería el NOT NULL/UNIQUE
    # de vuelta, así que se descartan esas filas huérfanas primero.
    op.execute("DELETE FROM chat_conversations WHERE consultation_id IS NULL")
    op.alter_column("chat_conversations", "consultation_id", existing_type=sa.String(), nullable=False)
    op.create_foreign_key(
        "chat_conversations_consultation_id_fkey",
        "chat_conversations", "consultations",
        ["consultation_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint("chat_conversations_consultation_id_key", "chat_conversations", ["consultation_id"])
