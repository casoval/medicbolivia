"""
Zona horaria de Bolivia (UTC-4, sin horario de verano) para lógica de
negocio que depende del "día calendario" del usuario/admin — típicamente
membresías.

Por qué existe esto: el resto de la app usa utcnow_naive() (correcto
para timestamps técnicos: created_at, refunded_at, etc). Pero para
"¿qué día es HOY para el admin en Bolivia?" eso está mal — Bolivia es
UTC-4, así que después de las 20:00 hora local, la hora UTC ya
está en el día siguiente. Eso causó el bug donde "Empezar hoy" (13 jul
en La Paz) terminaba guardando el 14 jul.

Las fechas de membresía (starts_at/ends_at) se guardan y se comparan
SIEMPRE en este dominio "Bolivia-naive" — no se deben mezclar con
utcnow_naive() en la misma comparación.
"""
from datetime import datetime, timezone, timedelta

BOLIVIA_TZ = timezone(timedelta(hours=-4))


def utcnow_naive() -> datetime:
    """
    Reemplazo no-deprecado de datetime.utcnow() (removido en versiones
    futuras de Python). Devuelve el instante actual en UTC como datetime
    naive (sin tzinfo) — mismo contrato que datetime.utcnow(), compatible
    con las columnas DateTime (sin timezone=True) del esquema actual.

    Usar esto para timestamps técnicos (created_at, paid_at, refunded_at,
    exp/iat de JWT, etc). Para "qué día es hoy en Bolivia" usar
    bolivia_now_naive() en su lugar, no este helper.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def bolivia_now_naive() -> datetime:
    """Instante actual, hora de Bolivia, como datetime naive (sin tzinfo)."""
    return datetime.now(BOLIVIA_TZ).replace(tzinfo=None)


def utc_naive_to_bolivia_naive(dt: datetime) -> datetime:
    """
    Convierte un datetime UTC-naive (ej. created_at, que usa utcnow_naive()
    como default) a su equivalente Bolivia-naive, para poder restarlo o
    compararlo contra campos que se guardan en hora Bolivia (ej.
    scheduled_at). Bolivia no tiene horario de verano, así que es una
    resta fija de 4 horas — no usar esto con datetimes que ya sean
    Bolivia-naive, se restaría 4h de más.
    """
    return dt - timedelta(hours=4)


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
