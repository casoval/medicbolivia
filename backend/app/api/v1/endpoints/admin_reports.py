"""
Reportes y métricas de negocio para admin — "/admin/reports/*".

Existe separado de admin.py (que ya pasa las 3000 líneas) a propósito.
admin/stats (en admin.py) responde "¿cómo estamos AHORA / este mes?" —
un solo snapshot, pensado para el vistazo rápido del dashboard principal.
Este módulo responde preguntas de tendencia y desglose que ese snapshot
no puede responder: ¿cómo veníamos los últimos meses?, ¿qué tan bien
convierte el embudo?, ¿qué profesionales generan más?, ¿los pacientes
vuelven? — por eso casi todos los endpoints aceptan un rango de fechas
en vez de estar fijos a "el mes actual".

Convención de fechas: igual que admin/stats, todo se filtra por
created_at (UTC-naive, ver utcnow_naive) — NO se convierte a hora
Bolivia. Es la misma convención que ya usa admin/stats (month_start =
utcnow_naive().replace(day=1,...)) — mantenerla acá evita que el mismo
mes muestre números distintos entre el dashboard principal y estos
reportes por una diferencia de huso horario.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case, cast, Date
from dateutil.relativedelta import relativedelta

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.core.timezone import utcnow_naive
from app.models.models import (
    Consultation, ConsultationStatus, ConsultationType,
    Payment, PaymentStatus, Professional, ProfessionalStatus,
    Patient, Rating, AgentLog, MembershipPayment,
)

router = APIRouter()


# ── Helper de rango de fechas, compartido por varios endpoints ────────
def _resolve_range(date_from: Optional[str], date_to: Optional[str]) -> tuple[datetime, datetime]:
    """
    Si no se manda nada, el rango por defecto es "el mes actual" (mismo
    criterio que admin/stats). date_to es EXCLUSIVO (< date_to), para
    poder pasar simplemente el día siguiente al último día que se quiere
    incluir sin pensar en "hasta las 23:59:59.999999".
    """
    now = utcnow_naive()
    if date_from:
        start = datetime.strptime(date_from, "%Y-%m-%d")
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if date_to:
        end = datetime.strptime(date_to, "%Y-%m-%d") + relativedelta(days=1)
    else:
        end = now
    return start, end


# Estados de Payment que cuentan como "cobro efectivamente recibido" en
# toda la plataforma — mismo criterio que ya usa admin/stats para
# monthly_revenue/platform_fee_month, repetido acá para no importar un
# private helper de otro módulo.
_PAID_STATUSES = [PaymentStatus.CONFIRMED, PaymentStatus.RELEASED_TO_PROFESSIONAL]


# ── GET /api/v1/admin/reports/revenue-trend ────────────────────────
# Serie mensual (GMV, comisión real, ingreso por membresías, consultas)
# de los últimos N meses. admin/stats solo tiene "el mes actual" — acá
# es donde se puede ver si la plataforma está creciendo o no.
@router.get("/revenue-trend", summary="Tendencia mensual de ingresos (últimos N meses)")
async def revenue_trend(
    months: int = Query(6, ge=1, le=24),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    now = utcnow_naive()
    range_start = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                   - relativedelta(months=months - 1))

    month_col = func.date_trunc('month', Payment.created_at).label('month')
    payment_rows = (await db.execute(
        select(
            month_col,
            func.coalesce(func.sum(Payment.amount), 0).label('gmv'),
            func.coalesce(func.sum(Payment.platform_fee), 0).label('platform_fee'),
            func.count(Payment.id).label('consultations_count'),
        )
        .where(and_(Payment.created_at >= range_start, Payment.status.in_(_PAID_STATUSES)))
        .group_by(month_col)
    )).all()

    membership_month_col = func.date_trunc('month', MembershipPayment.paid_at).label('month')
    membership_rows = (await db.execute(
        select(
            membership_month_col,
            func.coalesce(func.sum(MembershipPayment.fee_amount), 0).label('membership_revenue'),
        )
        .where(MembershipPayment.paid_at >= range_start)
        .group_by(membership_month_col)
    )).all()
    membership_by_month = {row.month.strftime('%Y-%m'): float(row.membership_revenue) for row in membership_rows}

    # Se arma la lista completa de meses del rango a mano (en vez de
    # confiar en que la query devuelva todos) para que un mes sin
    # actividad aparezca con ceros en vez de faltar en el gráfico.
    by_month = {row.month.strftime('%Y-%m'): row for row in payment_rows}
    result = []
    cursor = range_start
    for _ in range(months):
        key = cursor.strftime('%Y-%m')
        row = by_month.get(key)
        gmv = float(row.gmv) if row else 0.0
        platform_fee = float(row.platform_fee) if row else 0.0
        consultations_count = int(row.consultations_count) if row else 0
        membership_revenue = membership_by_month.get(key, 0.0)
        result.append({
            "month": key,
            "gmv": gmv,
            "platform_fee": platform_fee,
            "membership_revenue": membership_revenue,
            "total_platform_revenue": round(platform_fee + membership_revenue, 2),
            "consultations_count": consultations_count,
            "avg_ticket": round(gmv / consultations_count, 2) if consultations_count else 0.0,
            # % de comisión REALMENTE cobrado en promedio ese mes — la
            # cascada (promos/membresías) hace que nunca sea exactamente
            # el % "por defecto" configurado en /admin/settings.
            "effective_commission_pct": round((platform_fee / gmv * 100), 2) if gmv else 0.0,
        })
        cursor = cursor + relativedelta(months=1)
    return result


# ── GET /api/v1/admin/reports/revenue-by-specialty ─────────────────
@router.get("/revenue-by-specialty", summary="Ingresos por especialidad en un rango de fechas")
async def revenue_by_specialty(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD, default: inicio del mes actual"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD (inclusive), default: hoy"),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    start, end = _resolve_range(date_from, date_to)

    # Se agrupa por Professional.specialty (siempre NOT NULL) en vez de
    # Consultation.specialty (nullable, no siempre se completa) — así no
    # se pierden filas por falta de dato en la consulta puntual.
    rows = (await db.execute(
        select(
            Professional.specialty,
            func.coalesce(func.sum(Payment.amount), 0).label('gmv'),
            func.coalesce(func.sum(Payment.platform_fee), 0).label('platform_fee'),
            func.count(Payment.id).label('consultations_count'),
        )
        .join(Consultation, Consultation.id == Payment.consultation_id)
        .join(Professional, Professional.id == Consultation.professional_id)
        .where(and_(
            Payment.created_at >= start, Payment.created_at < end,
            Payment.status.in_(_PAID_STATUSES),
        ))
        .group_by(Professional.specialty)
        .order_by(func.sum(Payment.amount).desc())
    )).all()

    total_gmv = sum(float(r.gmv) for r in rows) or 1.0  # evita división por 0
    return [
        {
            "specialty": r.specialty,
            "gmv": float(r.gmv),
            "platform_fee": float(r.platform_fee),
            "consultations_count": r.consultations_count,
            "avg_ticket": round(float(r.gmv) / r.consultations_count, 2) if r.consultations_count else 0.0,
            "pct_of_total_gmv": round(float(r.gmv) / total_gmv * 100, 1),
        }
        for r in rows
    ]


# ── GET /api/v1/admin/reports/funnel ────────────────────────────────
# A diferencia del sistema de penalizaciones (que solo mira lo que es
# "culpa" del profesional), esto muestra el embudo completo: de cada
# consulta CREADA en el rango, a cuántas se les cobró de verdad y
# cuántas llegaron a completarse — y el desglose de outcome_note tal
# cual está guardado, SIN reinterpretar categorías, para no arriesgar
# una clasificación incorrecta de un motivo ambiguo.
@router.get("/funnel", summary="Embudo de conversión de consultas en un rango de fechas")
async def conversion_funnel(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    start, end = _resolve_range(date_from, date_to)
    base_filter = and_(Consultation.created_at >= start, Consultation.created_at < end)

    total_created = (await db.execute(
        select(func.count(Consultation.id)).where(base_filter)
    )).scalar_one()

    # "Llegó a cobrarse" se mide desde Payment (fuente de verdad del
    # dinero), no desde Consultation.status — así cuenta incluso si el
    # status actual ya avanzó a COMPLETED o se usó para un REFUNDED
    # posterior; lo que importa acá es si en algún momento hubo un cobro
    # confirmado.
    reached_payment = (await db.execute(
        select(func.count(func.distinct(Payment.consultation_id)))
        .join(Consultation, Consultation.id == Payment.consultation_id)
        .where(base_filter, Payment.status.in_(_PAID_STATUSES))
    )).scalar_one()

    completed = (await db.execute(
        select(func.count(Consultation.id)).where(base_filter, Consultation.status == ConsultationStatus.COMPLETED)
    )).scalar_one()

    cancelled = (await db.execute(
        select(func.count(Consultation.id)).where(base_filter, Consultation.status == ConsultationStatus.CANCELLED)
    )).scalar_one()

    # Distribución completa por status actual (no solo los 4 de arriba)
    status_rows = (await db.execute(
        select(Consultation.status, func.count(Consultation.id))
        .where(base_filter)
        .group_by(Consultation.status)
    )).all()
    by_status = {s.value: c for s, c in status_rows}

    # outcome_note tal cual — motivo exacto de por qué no llegó a
    # completarse, sin agrupar en categorías propias para no arriesgar
    # una mala clasificación de un caso ambiguo.
    reason_rows = (await db.execute(
        select(Consultation.outcome_note, func.count(Consultation.id))
        .where(base_filter, Consultation.outcome_note.isnot(None))
        .group_by(Consultation.outcome_note)
        .order_by(func.count(Consultation.id).desc())
    )).all()

    return {
        "date_from": start.date().isoformat(),
        "date_to": (end - relativedelta(days=1)).date().isoformat(),
        "total_created": total_created,
        "reached_payment": reached_payment,
        "completed": completed,
        "cancelled": cancelled,
        "pct_reached_payment": round(reached_payment / total_created * 100, 1) if total_created else 0.0,
        "pct_completed": round(completed / total_created * 100, 1) if total_created else 0.0,
        "pct_cancelled": round(cancelled / total_created * 100, 1) if total_created else 0.0,
        "by_status": by_status,
        "outcome_note_breakdown": [{"outcome_note": r, "count": c} for r, c in reason_rows],
    }


# ── GET /api/v1/admin/reports/retention ─────────────────────────────
# No es por cohorte de fecha de alta — mira TODO el historial de cada
# paciente/profesional (sin filtrar por rango) para responder "de la
# gente que alguna vez usó la plataforma, ¿cuántos volvieron?". Un
# filtro por rango acá cortaría artificialmente historiales que
# arrancaron antes del rango elegido.
@router.get("/retention", summary="Recurrencia de pacientes y profesionales (todo el historial)")
async def retention(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    # Consultas completadas por paciente — solo COMPLETED cuenta como
    # "uso real" (una consulta cancelada no dice nada sobre si el
    # paciente quedó conforme y volvería).
    per_patient = (await db.execute(
        select(Consultation.patient_id, func.count(Consultation.id).label('n'),
               func.min(Consultation.created_at).label('first_at'),
               func.max(Consultation.created_at).label('last_at'))
        .where(Consultation.status == ConsultationStatus.COMPLETED)
        .group_by(Consultation.patient_id)
    )).all()

    total_patients_with_consultation = len(per_patient)
    recurring_patients = [r for r in per_patient if r.n >= 2]
    pct_recurring_patients = (
        round(len(recurring_patients) / total_patients_with_consultation * 100, 1)
        if total_patients_with_consultation else 0.0
    )

    # Tiempo entre 1ra y última consulta, promediado SOLO entre quienes
    # tienen 2+ (para quienes tienen 1 sola, first_at == last_at y no
    # aporta nada a esta pregunta).
    if recurring_patients:
        avg_days_between = sum(
            (r.last_at - r.first_at).total_seconds() / 86400 for r in recurring_patients
        ) / len(recurring_patients)
    else:
        avg_days_between = 0.0

    # Mismo análisis del lado del profesional: ¿tiene pacientes que
    # volvieron a elegirlo a ÉL específicamente (no solo a la
    # plataforma)?
    per_pair = (await db.execute(
        select(Consultation.professional_id, Consultation.patient_id, func.count(Consultation.id).label('n'))
        .where(Consultation.status == ConsultationStatus.COMPLETED, Consultation.professional_id.isnot(None))
        .group_by(Consultation.professional_id, Consultation.patient_id)
    )).all()
    professionals_with_any_patient = {r.professional_id for r in per_pair}
    professionals_with_repeat_patient = {r.professional_id for r in per_pair if r.n >= 2}

    total_active_professionals = (await db.execute(
        select(func.count(Professional.id)).where(Professional.status == ProfessionalStatus.APPROVED)
    )).scalar_one()

    return {
        "patients": {
            "total_with_completed_consultation": total_patients_with_consultation,
            "recurring_2plus": len(recurring_patients),
            "pct_recurring": pct_recurring_patients,
            "avg_days_between_first_and_last_for_recurring": round(avg_days_between, 1),
        },
        "professionals": {
            "total_active": total_active_professionals,
            "with_at_least_one_completed_patient": len(professionals_with_any_patient),
            "with_repeat_patient": len(professionals_with_repeat_patient),
            "pct_with_repeat_patient": (
                round(len(professionals_with_repeat_patient) / len(professionals_with_any_patient) * 100, 1)
                if professionals_with_any_patient else 0.0
            ),
        },
    }


# ── GET /api/v1/admin/reports/professionals-ranking ────────────────
@router.get("/professionals-ranking", summary="Ranking de profesionales por ingresos/consultas/no-show en un rango")
async def professionals_ranking(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    order_by: str = Query("revenue", pattern="^(revenue|consultations|rating|no_show_rate)$"),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    start, end = _resolve_range(date_from, date_to)
    base_filter = and_(Consultation.created_at >= start, Consultation.created_at < end,
                        Consultation.professional_id.isnot(None))

    rows = (await db.execute(
        select(
            Consultation.professional_id,
            func.count(Consultation.id).label('total_consultations'),
            func.sum(case((Consultation.status == ConsultationStatus.COMPLETED, 1), else_=0)).label('completed'),
            func.sum(case((Consultation.outcome_note == 'PROFESSIONAL_NO_SHOW', 1), else_=0)).label('no_shows'),
        )
        .where(base_filter)
        .group_by(Consultation.professional_id)
    )).all()

    # revenue_generated aparte y SOLO de consultas con Payment confirmado
    # — Consultation.amount es el precio COTIZADO al crear la consulta,
    # existe aunque después se cancele o nunca se cobre. Sumarlo directo
    # (como se hacía antes acá) contaba como "ingreso" el monto de
    # consultas canceladas que jamás se pagaron. Mismo criterio que ya
    # se usa en revenue-trend/revenue-by-specialty: Payment es la única
    # fuente de verdad de si hubo cobro real.
    revenue_rows = (await db.execute(
        select(
            Consultation.professional_id,
            func.coalesce(func.sum(Payment.amount), 0).label('revenue_generated'),
        )
        .join(Payment, Payment.consultation_id == Consultation.id)
        .where(base_filter, Payment.status.in_(_PAID_STATUSES))
        .group_by(Consultation.professional_id)
    )).all()
    revenue_by_prof = {r.professional_id: float(r.revenue_generated) for r in revenue_rows}

    prof_ids = [r.professional_id for r in rows]
    profs = {}
    if prof_ids:
        prof_rows = (await db.execute(
            select(Professional).where(Professional.id.in_(prof_ids))
        )).scalars().all()
        profs = {p.id: p for p in prof_rows}

    items = []
    for r in rows:
        p = profs.get(r.professional_id)
        if not p:
            continue
        no_show_rate = round(r.no_shows / r.total_consultations * 100, 1) if r.total_consultations else 0.0
        items.append({
            "professional_id": p.id,
            "name": f"{p.first_name} {p.last_name}",
            "specialty": p.specialty,
            "total_consultations": r.total_consultations,
            "completed_consultations": int(r.completed),
            "revenue_generated": revenue_by_prof.get(r.professional_id, 0.0),
            "no_show_rate": no_show_rate,
            # Rating cacheado en Professional (histórico, no del rango
            # elegido — no hay forma barata de recalcularlo solo para el
            # rango sin sumar otra query pesada por cada profesional).
            "average_rating": float(p.average_rating) if p.average_rating is not None else None,
            "total_ratings": p.total_ratings,
        })

    sort_key = {
        "revenue": lambda x: x["revenue_generated"],
        "consultations": lambda x: x["total_consultations"],
        "rating": lambda x: (x["average_rating"] or 0),
        "no_show_rate": lambda x: x["no_show_rate"],
    }[order_by]
    items.sort(key=sort_key, reverse=True)
    return items[:limit]


# ── GET /api/v1/admin/reports/agent-conversion ──────────────────────
# APROXIMADO a propósito — ver nota abajo. AgentLog.consultation_id
# nunca se completa hoy (ver app/agents/coordinator.py: el log se crea
# sin ese campo), así que no hay forma de saber con certeza absoluta
# qué sesión del agente terminó en qué consulta. Lo que sí se puede
# medir con confianza razonable: cuántos usuarios distintos hablaron
# con el agente en el rango, y de esos, cuántos generaron una consulta
# con pago confirmado EN EL MISMO RANGO. Es una cota razonable, no un
# tracking exacto sesión-a-sesión.
@router.get("/agent-conversion", summary="Conversión aproximada: usuarios que usaron el agente vs. los que pagaron una consulta")
async def agent_conversion(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    start, end = _resolve_range(date_from, date_to)

    agent_users = (await db.execute(
        select(func.distinct(AgentLog.user_id))
        .where(AgentLog.created_at >= start, AgentLog.created_at < end, AgentLog.user_id.isnot(None))
    )).scalars().all()
    # Se normaliza a str explícito: func.distinct() sobre una columna
    # UUID(as_uuid=False) a veces devuelve el tipo nativo de asyncpg
    # (uuid.UUID) en vez de str, mientras que un SELECT de columna
    # directa sí respeta el as_uuid=False. Sin este str(), el cruce de
    # sets/dicts más abajo falla con un KeyError silencioso (comparando
    # uuid.UUID contra str, que nunca son == aunque tengan el mismo
    # valor) — se detectó probando este endpoint con datos reales.
    agent_user_set = {str(u) for u in agent_users}

    if not agent_user_set:
        return {
            "date_from": start.date().isoformat(),
            "date_to": (end - relativedelta(days=1)).date().isoformat(),
            "users_with_agent_session": 0,
            "of_those_who_paid": 0,
            "pct_conversion_approx": 0.0,
            "note": "APROXIMADO: se correlaciona por user_id + mismo rango de fechas, no por sesión exacta "
                    "(AgentLog.consultation_id no se completa hoy en el flujo del agente).",
        }

    # Pacientes vinculados a esos usuarios (Patient.user_id == User.id)
    patient_rows = (await db.execute(
        select(Patient.id, Patient.user_id).where(Patient.user_id.in_(agent_user_set))
    )).all()
    patient_id_to_user = {str(row.id): str(row.user_id) for row in patient_rows}

    if not patient_id_to_user:
        paid_user_ids = set()
    else:
        paid_patient_ids = (await db.execute(
            select(func.distinct(Consultation.patient_id))
            .join(Payment, Payment.consultation_id == Consultation.id)
            .where(
                Consultation.patient_id.in_(list(patient_id_to_user.keys())),
                Consultation.created_at >= start, Consultation.created_at < end,
                Payment.status.in_(_PAID_STATUSES),
            )
        )).scalars().all()
        paid_user_ids = {patient_id_to_user[str(pid)] for pid in paid_patient_ids}

    return {
        "date_from": start.date().isoformat(),
        "date_to": (end - relativedelta(days=1)).date().isoformat(),
        "users_with_agent_session": len(agent_user_set),
        "of_those_who_paid": len(paid_user_ids),
        "pct_conversion_approx": round(len(paid_user_ids) / len(agent_user_set) * 100, 1),
        "note": "APROXIMADO: se correlaciona por user_id + mismo rango de fechas, no por sesión exacta "
                "(AgentLog.consultation_id no se completa hoy en el flujo del agente).",
    }
