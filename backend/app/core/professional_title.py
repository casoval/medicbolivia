"""
app/core/professional_title.py
Tratamiento formal ("Dr.", "Dra." o "Dr(a).") a anteponer al nombre de un
profesional, según su campo `gender` (Professional.gender: "Masculino" /
"Femenino" / "Otro" / None — ver formulario de registro en
frontend/auth/register/professional y el admin).

Por qué existe: antes había más de una decena de lugares (WhatsApp,
notificaciones in-app, chat, recetas, órdenes de laboratorio, videollamada)
que armaban el saludo/nombre a mano con el prefijo genérico "Dr(a)." o,
peor, con "Dr." fijo (asumiendo que todo profesional es varón) sin mirar
el género cargado. Esta función centraliza esa decisión una sola vez:
  - "Masculino" → "Dr."
  - "Femenino"  → "Dra."
  - cualquier otro valor (None, "", "Otro", o algo no reconocido) →
    "Dr(a)." — el mismo genérico de siempre, para no inventar un género
    que el profesional no cargó.

El punto final queda incluido en el valor devuelto a propósito, así el
llamador solo hace f"{professional_title(p.gender)} {p.first_name} ...".
"""
from typing import Optional

_MASCULINO = {"masculino", "m", "male"}
_FEMENINO = {"femenino", "f", "female"}


def professional_title(gender: Optional[str]) -> str:
    normalized = (gender or "").strip().lower()
    if normalized in _MASCULINO:
        return "Dr."
    if normalized in _FEMENINO:
        return "Dra."
    return "Dr(a)."


def professional_full_name(first_name: str, last_name: str, gender: Optional[str]) -> str:
    """Atajo para el caso más común: "Dr. Juan Pérez" / "Dra. Juana Pérez" /
    "Dr(a). Juan Pérez"."""
    return f"{professional_title(gender)} {first_name} {last_name}"
