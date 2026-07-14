"""
app/services/commission.py
Resuelve qué % de comisión aplica en un momento dado, combinando:

  1. Período de comisión INDIVIDUAL activo para ese profesional (más
     prioritario — permite promociones tipo "5% los primeros 3 meses"
     para un profesional puntual).
  2. Período de comisión GLOBAL activo (promociones para toda la
     plataforma, ej. "10% este mes, 15% el próximo").
  3. PlatformSettings.commission_percent — el valor simple de respaldo
     que se usa si no hay ningún período configurado.
  4. settings.PLATFORM_FEE_PERCENT (config estática) como último respaldo
     si ni siquiera existe la fila de PlatformSettings.

Importante: esta función solo dice qué % aplica AHORA. El resultado se
guarda como foto fija en la Consultation/Payment al momento de crearlos
(ver consultations.py), así que cambios futuros de comisión nunca
recalculan consultas ya generadas.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import CommissionPeriod, CommissionScope, PlatformSettings, ProfessionalMembership
from app.core.config import settings
from app.core.timezone import BOLIVIA_TZ


async def _has_active_membership(db: AsyncSession, professional_id: str, at: datetime) -> bool:
    """
    True si el profesional tiene una membresía habilitada por el admin que
    cubre el momento `at`. La membresía es el nivel de MÁS prioridad de
    todos — si está activa, la comisión es 0% sin importar promociones
    globales o individuales configuradas en CommissionPeriod.

    `at` llega en hora UTC (igual que el resto de la app), pero
    ProfessionalMembership.starts_at/ends_at se guardan en hora de
    Bolivia (ver app.core.timezone) porque son "días calendario" que
    eligió el admin, no timestamps técnicos. Se convierte acá para no
    comparar peras con manzanas.
    """
    if at.tzinfo is not None:
        at = at.astimezone(timezone.utc).replace(tzinfo=None)
    at_bolivia = (at.replace(tzinfo=timezone.utc)).astimezone(BOLIVIA_TZ).replace(tzinfo=None)
    result = await db.execute(
        select(ProfessionalMembership).where(
            ProfessionalMembership.professional_id == professional_id,
            ProfessionalMembership.active == True,  # noqa: E712
            ProfessionalMembership.starts_at <= at_bolivia,
            or_(ProfessionalMembership.ends_at.is_(None), ProfessionalMembership.ends_at > at_bolivia),
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _find_active_period(
    db: AsyncSession, scope: CommissionScope, professional_id: str | None, at: datetime
) -> CommissionPeriod | None:
    conditions = [
        CommissionPeriod.scope == scope,
        CommissionPeriod.active == True,  # noqa: E712
        CommissionPeriod.starts_at <= at,
        or_(CommissionPeriod.ends_at.is_(None), CommissionPeriod.ends_at > at),
    ]
    if scope == CommissionScope.PROFESSIONAL:
        conditions.append(CommissionPeriod.professional_id == professional_id)

    result = await db.execute(
        select(CommissionPeriod)
        .where(and_(*conditions))
        .order_by(CommissionPeriod.starts_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def resolve_commission_percent(
    db: AsyncSession,
    professional_id: str | None,
    at: datetime | None = None,
) -> Decimal:
    """
    Devuelve el % de comisión (ej. Decimal("10.00") = 10%) vigente ahora
    mismo para un profesional, en formato porcentaje (0-100), listo para
    guardar en commission_percent_applied.
    """
    at = at or datetime.utcnow()

    if professional_id:
        if await _has_active_membership(db, professional_id, at):
            return Decimal("0.00")
        individual = await _find_active_period(db, CommissionScope.PROFESSIONAL, professional_id, at)
        if individual:
            return individual.percent

    global_period = await _find_active_period(db, CommissionScope.GLOBAL, None, at)
    if global_period:
        return global_period.percent

    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "global"))
    row = result.scalar_one_or_none()
    if row is not None and row.commission_percent is not None:
        return Decimal(str(row.commission_percent))

    # Último respaldo: config estática del .env (histórico, PLATFORM_FEE_PERCENT es una fracción 0-1).
    return Decimal(str(settings.PLATFORM_FEE_PERCENT)) * Decimal("100")


async def get_professional_commission_summary(
    db: AsyncSession, professional_id: str | None, at: datetime | None = None
) -> dict:
    """
    Info lista para mostrar en el perfil del profesional o en el panel
    admin: % vigente + de dónde sale (individual / global / default).
    """
    at = at or datetime.utcnow()

    if professional_id and await _has_active_membership(db, professional_id, at):
        return {"percent": Decimal("0.00"), "source": "MEMBERSHIP", "label": None, "ends_at": None}

    individual = (
        await _find_active_period(db, CommissionScope.PROFESSIONAL, professional_id, at)
        if professional_id else None
    )
    if individual:
        return {
            "percent": individual.percent,
            "source": "PROFESSIONAL",
            "label": individual.label,
            "ends_at": individual.ends_at,
        }

    global_period = await _find_active_period(db, CommissionScope.GLOBAL, None, at)
    if global_period:
        return {
            "percent": global_period.percent,
            "source": "GLOBAL_PROMO",
            "label": global_period.label,
            "ends_at": global_period.ends_at,
        }

    percent = await resolve_commission_percent(db, None, at)
    return {"percent": percent, "source": "DEFAULT", "label": None, "ends_at": None}
