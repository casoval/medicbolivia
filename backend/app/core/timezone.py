"""
Zona horaria de Bolivia (UTC-4, sin horario de verano) para lógica de
negocio que depende del "día calendario" del usuario/admin — típicamente
membresías.

Por qué existe esto: el resto de la app usa datetime.utcnow() (correcto
para timestamps técnicos: created_at, refunded_at, etc). Pero para
"¿qué día es HOY para el admin en Bolivia?" eso está mal — Bolivia es
UTC-4, así que después de las 20:00 hora local, datetime.utcnow() ya
está en el día siguiente. Eso causó el bug donde "Empezar hoy" (13 jul
en La Paz) terminaba guardando el 14 jul.

Las fechas de membresía (starts_at/ends_at) se guardan y se comparan
SIEMPRE en este dominio "Bolivia-naive" — no se deben mezclar con
datetime.utcnow() en la misma comparación.
"""
from datetime import datetime, timezone, timedelta

BOLIVIA_TZ = timezone(timedelta(hours=-4))


def bolivia_now_naive() -> datetime:
    """Instante actual, hora de Bolivia, como datetime naive (sin tzinfo)."""
    return datetime.now(BOLIVIA_TZ).replace(tzinfo=None)


def bolivia_today_midnight_naive() -> datetime:
    """Medianoche de HOY en Bolivia, como datetime naive."""
    now = bolivia_now_naive()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def as_bolivia_calendar_day(dt: datetime) -> datetime:
    """
    Toma cualquier datetime (naive o aware) y devuelve la medianoche
    Bolivia-naive de SU FECHA (ignora la hora — para membresías solo
    importa el día calendario que el admin eligió, no la hora exacta).
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(BOLIVIA_TZ).replace(tzinfo=None)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)
