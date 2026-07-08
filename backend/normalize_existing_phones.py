"""
normalize_existing_phones.py

Backfill necesario DESPUÉS de aplicar el fix de app/core/phone.py: antes
de ese fix, User.phone se guardaba tal cual lo tipeaba la persona en el
registro (8 dígitos, con código de país, o incluso con '+'), sin forzar
un formato único. Esto rompía la identificación de conversaciones de
WhatsApp para cualquier cuenta registrada ANTES del fix, porque Baileys
siempre entrega el número con código de país.

Qué hace, en orden:
1. Recorre todos los Users con teléfono no nulo.
2. Intenta normalizarlo con normalize_bo_phone(). Si ya está en formato
   canónico, no toca nada (idempotente — se puede correr más de una vez
   sin riesgo).
3. Si detecta que DOS usuarios distintos normalizarían al mismo número
   canónico (ej. uno guardado "72345678" y otro "59172345678" — mismo
   número real, cuenta duplicada), NO los toca y los deja listados al
   final para revisión manual — fusionar cuentas es una decisión de
   negocio, no algo que este script deba resolver solo.
4. Si el número no matchea el formato boliviano esperado, también queda
   listado al final sin tocar (dato corrupto que hay que revisar a mano).

Uso:
    (venv) $ python normalize_existing_phones.py            # dry-run (no escribe nada)
    (venv) $ python normalize_existing_phones.py --apply     # aplica los cambios
"""
import asyncio
import sys

from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.models.models import User
from app.core.phone import normalize_bo_phone, InvalidPhoneError


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.phone.isnot(None)))
        users = result.scalars().all()

        normalized_to_users: dict[str, list[User]] = {}
        invalid: list[User] = []

        for user in users:
            try:
                canonical = normalize_bo_phone(user.phone)
            except InvalidPhoneError:
                invalid.append(user)
                continue
            normalized_to_users.setdefault(canonical, []).append(user)

        to_update = []
        conflicts = []

        for canonical, group in normalized_to_users.items():
            if len(group) > 1:
                conflicts.append((canonical, group))
                continue
            user = group[0]
            if user.phone != canonical:
                to_update.append((user, canonical))

        print(f"Total usuarios con teléfono: {len(users)}")
        print(f"A normalizar: {len(to_update)}")
        print(f"Conflictos (mismo número, cuentas distintas — revisar a mano): {len(conflicts)}")
        print(f"Inválidos (no boliviano reconocible — revisar a mano): {len(invalid)}")
        print()

        for user, canonical in to_update:
            print(f"  {user.id}  {user.phone!r} -> {canonical!r}  ({user.role.value})")

        if conflicts:
            print("\n⚠️  CONFLICTOS (no se tocan, decidir manualmente cuál cuenta conservar):")
            for canonical, group in conflicts:
                print(f"  {canonical}:")
                for u in group:
                    print(f"    - {u.id}  {u.phone!r}  ({u.role.value}, creado {u.created_at})")

        if invalid:
            print("\n⚠️  INVÁLIDOS (no se tocan):")
            for u in invalid:
                print(f"    - {u.id}  {u.phone!r}  ({u.role.value})")

        if not apply:
            print("\nDry-run — no se escribió nada. Correr con --apply para aplicar los cambios.")
            return

        for user, canonical in to_update:
            user.phone = canonical
        await db.commit()
        print(f"\n✅ {len(to_update)} usuarios actualizados.")


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(main(apply))
