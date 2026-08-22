"""
app/api/v1/endpoints/clinical_notes.py
Historia clínica por consulta (Gap 4).

Reglas de privacidad:
  - El médico que atendió la consulta crea/edita su nota, en cualquier
    momento: DURANTE la videollamada (IN_PROGRESS) o justo después
    (COMPLETED) — igual que la receta, no depende de que se acuerde luego.
  - El paciente ve sus propias notas marcadas is_visible_to_patient=True.
  - El paciente decide, nota por nota, si la comparte con CUALQUIER otro
    médico verificado de la plataforma (shared_with_professionals=True).
    Es una decisión exclusiva del paciente — el médico no puede activarla.
  - El médico que escribió la nota siempre puede verla después, sin
    importar la configuración de privacidad del paciente, por si ese
    paciente vuelve a consultarlo.
"""
from datetime import timedelta
from app.core.timezone import utcnow_naive
from app.core.professional_title import professional_full_name
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional
from app.models.models import (
    User, Patient, Professional, Consultation, ClinicalNote, ClinicalNoteAddendum,
    ConsultationStatus, ProfessionalStatus
)
from app.schemas.schemas import (
    ClinicalNoteCreateRequest, ClinicalNoteUpdateRequest,
    ClinicalNoteShareRequest, ClinicalNoteResponse,
    ClinicalNoteAddendumCreateRequest, ClinicalNoteAddendumResponse
)

router = APIRouter()

# Ventana de edición libre después de que la nota fue creada: pasado este
# tiempo, PATCH queda bloqueado y las correcciones deben hacerse vía
# addendum (nueva entrada, nunca se sobreescribe lo original).
EDIT_WINDOW = timedelta(hours=24)


def _is_editable(note: ClinicalNote, consultation: Consultation | None) -> bool:
    # Mientras la consulta sigue en curso, edición libre (autosave en vivo).
    if consultation and consultation.status == ConsultationStatus.IN_PROGRESS:
        return True
    return utcnow_naive() < note.created_at + EDIT_WINDOW


async def _enrich(
    db: AsyncSession,
    note: ClinicalNote,
    professional: Professional | None,
    patient: Patient | None = None,
    consultation: Consultation | None = None,
) -> ClinicalNoteResponse:
    base = ClinicalNoteResponse.model_validate(note)
    if professional:
        base.professional_name = professional_full_name(professional.first_name, professional.last_name, professional.gender)
        base.professional_specialty = professional.specialty
    if patient:
        base.patient_name = f"{patient.first_name} {patient.last_name}"
        base.patient_photo_url = patient.photo_url

    if consultation is None:
        cons_result = await db.execute(select(Consultation).where(Consultation.id == note.consultation_id))
        consultation = cons_result.scalar_one_or_none()
    base.is_editable = _is_editable(note, consultation)
    base.edit_window_expires_at = note.created_at + EDIT_WINDOW

    # note.addenda ya viene cargado (relación lazy="selectin"), así que no
    # hace falta una consulta aparte.
    enriched_addenda = []
    for a in note.addenda:
        a_resp = ClinicalNoteAddendumResponse.model_validate(a)
        prof_result = await db.execute(select(Professional).where(Professional.id == a.professional_id))
        a_prof = prof_result.scalar_one_or_none()
        if a_prof:
            a_resp.professional_name = professional_full_name(a_prof.first_name, a_prof.last_name, a_prof.gender)
        enriched_addenda.append(a_resp)
    base.addenda = enriched_addenda

    return base


async def _enrich_many(
    db: AsyncSession,
    notes: list[ClinicalNote],
    professional: Professional | None = None,
    patient: Patient | None = None,
) -> list[ClinicalNoteResponse]:
    """
    Versión en bulk de _enrich(): resuelve profesional, paciente,
    consulta y autores de addenda con UNA consulta por tabla (usando
    `IN (...)`), en vez de que _enrich() dispare 2-4 queries por cada
    nota dentro del loop del caller. Antes, un médico o paciente con
    cientos de notas acumuladas hacía que ese endpoint se pusiera cada
    vez más lento con el uso real de la plataforma.

    `professional`/`patient`: pasar solo si TODAS las notas son del mismo
    profesional o del mismo paciente (ej. "mis notas escritas" siempre es
    el profesional logueado) — evita la query de bulk para esa entidad.
    Si no se pasa, se resuelve para todos los IDs distintos presentes en
    `notes`.
    """
    if not notes:
        return []

    professionals_by_id: dict[str, Professional] = {}
    if professional:
        professionals_by_id[professional.id] = professional
    else:
        prof_ids = {n.professional_id for n in notes if n.professional_id}
        if prof_ids:
            result = await db.execute(select(Professional).where(Professional.id.in_(prof_ids)))
            professionals_by_id = {p.id: p for p in result.scalars().all()}

    patients_by_id: dict[str, Patient] = {}
    if patient:
        patients_by_id[patient.id] = patient
    else:
        patient_ids = {n.patient_id for n in notes if n.patient_id}
        if patient_ids:
            result = await db.execute(select(Patient).where(Patient.id.in_(patient_ids)))
            patients_by_id = {p.id: p for p in result.scalars().all()}

    consultation_ids = {n.consultation_id for n in notes if n.consultation_id}
    consultations_by_id: dict[str, Consultation] = {}
    if consultation_ids:
        result = await db.execute(select(Consultation).where(Consultation.id.in_(consultation_ids)))
        consultations_by_id = {c.id: c for c in result.scalars().all()}

    # Autores de los addenda: pueden ser distintos del profesional dueño de
    # la nota (otro médico agregando un addendum), así que se resuelven
    # aparte — reutilizando lo ya cargado en professionals_by_id cuando
    # coincide, para no repetir esos IDs en la query de abajo.
    addendum_prof_ids = {a.professional_id for n in notes for a in n.addenda if a.professional_id}
    addendum_profs_by_id: dict[str, Professional] = dict(professionals_by_id)
    missing_addendum_ids = addendum_prof_ids - addendum_profs_by_id.keys()
    if missing_addendum_ids:
        result = await db.execute(select(Professional).where(Professional.id.in_(missing_addendum_ids)))
        addendum_profs_by_id.update({p.id: p for p in result.scalars().all()})

    enriched: list[ClinicalNoteResponse] = []
    for n in notes:
        base = ClinicalNoteResponse.model_validate(n)

        prof = professionals_by_id.get(n.professional_id)
        if prof:
            base.professional_name = professional_full_name(prof.first_name, prof.last_name, prof.gender)
            base.professional_specialty = prof.specialty

        pat = patients_by_id.get(n.patient_id)
        if pat:
            base.patient_name = f"{pat.first_name} {pat.last_name}"
            base.patient_photo_url = pat.photo_url

        consultation = consultations_by_id.get(n.consultation_id)
        base.is_editable = _is_editable(n, consultation)
        base.edit_window_expires_at = n.created_at + EDIT_WINDOW

        enriched_addenda = []
        for a in n.addenda:
            a_resp = ClinicalNoteAddendumResponse.model_validate(a)
            a_prof = addendum_profs_by_id.get(a.professional_id)
            if a_prof:
                a_resp.professional_name = professional_full_name(a_prof.first_name, a_prof.last_name, a_prof.gender)
            enriched_addenda.append(a_resp)
        base.addenda = enriched_addenda

        enriched.append(base)

    return enriched


async def _get_professional_or_403(current_user: User, db: AsyncSession) -> Professional:
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")
    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=403, detail="Tu perfil no está verificado")
    return professional


# ── POST /clinical-notes ─────────────────────────────
# Crea (o reutiliza, ver nota abajo) la historia clínica de una consulta.
# Disponible mientras la consulta está EN CURSO o RECIÉN COMPLETADA, para
# que el médico pueda ir llenándola en vivo durante la videollamada.
@router.post(
    "",
    response_model=ClinicalNoteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear historia clínica de una consulta (puede hacerse en vivo durante la videollamada)"
)
async def create_clinical_note(
    data: ClinicalNoteCreateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = await _get_professional_or_403(current_user, db)

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.professional_id == professional.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no te pertenece")

    if consultation.status not in (ConsultationStatus.IN_PROGRESS, ConsultationStatus.COMPLETED):
        raise HTTPException(
            status_code=400,
            detail="Solo puedes crear la historia clínica de consultas en curso o completadas."
        )

    # Evitar duplicados: si ya existe una nota para esta consulta, no se
    # crea otra — el médico debe usar PATCH para seguir editándola
    # (soporta autosave mientras habla con el paciente).
    existing_result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.consultation_id == data.consultation_id)
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Ya existe una historia clínica para esta consulta. Usa el endpoint de edición (PATCH) para continuar."
        )

    note = ClinicalNote(
        consultation_id=data.consultation_id,
        professional_id=professional.id,
        patient_id=consultation.patient_id,
        subjective=data.subjective,
        objective=data.objective,
        assessment=data.assessment,
        plan=data.plan,
        is_visible_to_patient=data.is_visible_to_patient,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    logger.info(f"Historia clínica creada: {note.id} | consulta: {consultation.id} | profesional: {professional.id}")
    return await _enrich(db, note, professional)


# ── PATCH /clinical-notes/{note_id} ──────────────────
# Edición incremental — pensada para autosave mientras el médico va
# escribiendo durante la videollamada. Todos los campos son opcionales.
@router.patch(
    "/{note_id}",
    response_model=ClinicalNoteResponse,
    summary="Editar historia clínica (autosave durante la videollamada)"
)
async def update_clinical_note(
    note_id: str,
    data: ClinicalNoteUpdateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = await _get_professional_or_403(current_user, db)

    note_result = await db.execute(
        select(ClinicalNote).where(
            ClinicalNote.id == note_id,
            ClinicalNote.professional_id == professional.id,
        )
    )
    note = note_result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Historia clínica no encontrada o no te pertenece")

    cons_result = await db.execute(select(Consultation).where(Consultation.id == note.consultation_id))
    consultation = cons_result.scalar_one_or_none()
    if consultation and consultation.status not in (ConsultationStatus.IN_PROGRESS, ConsultationStatus.COMPLETED):
        raise HTTPException(
            status_code=400,
            detail="Solo puedes editar la historia clínica de consultas en curso o completadas."
        )

    if not _is_editable(note, consultation):
        raise HTTPException(
            status_code=403,
            detail=(
                "Pasaron más de 24 horas desde que se creó esta historia clínica, "
                "así que ya no se puede editar directamente. Usa un addendum para "
                "agregar una corrección con su propia fecha, sin alterar la nota original."
            ),
        )

    if data.subjective is not None:
        note.subjective = data.subjective
    if data.objective is not None:
        note.objective = data.objective
    if data.assessment is not None:
        note.assessment = data.assessment
    if data.plan is not None:
        note.plan = data.plan
    if data.is_visible_to_patient is not None:
        note.is_visible_to_patient = data.is_visible_to_patient

    note.edit_count = (note.edit_count or 0) + 1

    await db.commit()
    await db.refresh(note)

    return await _enrich(db, note, professional, consultation=consultation)


# ── POST /clinical-notes/{note_id}/addendum ──────────
# Corrección o agregado posterior a la ventana de edición de 24h. Nunca
# sobreescribe la nota original — queda como entrada nueva, con su propia
# fecha, visible para cualquiera que pueda ver la nota original. No tiene
# restricción de ventana: un addendum siempre queda registrado con su
# fecha real, así que no hay riesgo de reescribir el pasado.
@router.post(
    "/{note_id}/addendum",
    response_model=ClinicalNoteResponse,
    summary="Agregar un addendum (corrección posterior) a una historia clínica"
)
async def add_addendum(
    note_id: str,
    data: ClinicalNoteAddendumCreateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = await _get_professional_or_403(current_user, db)

    note_result = await db.execute(
        select(ClinicalNote).where(
            ClinicalNote.id == note_id,
            ClinicalNote.professional_id == professional.id,
        )
    )
    note = note_result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Historia clínica no encontrada o no te pertenece")

    addendum = ClinicalNoteAddendum(
        clinical_note_id=note.id,
        professional_id=professional.id,
        content=data.content,
    )
    db.add(addendum)
    await db.commit()

    await db.refresh(note)
    logger.info(f"Addendum agregado a historia clínica {note.id} por profesional {professional.id}")
    return await _enrich(db, note, professional)


# ── PATCH /clinical-notes/{note_id}/share ────────────
# SOLO el paciente puede activar/desactivar que esta nota se comparta con
# otros médicos de la plataforma. El profesional no tiene acceso a este
# endpoint — la privacidad es decisión exclusiva del paciente.
@router.patch(
    "/{note_id}/share",
    response_model=ClinicalNoteResponse,
    summary="[Paciente] Compartir o dejar de compartir una nota con otros médicos de la plataforma"
)
async def share_clinical_note(
    note_id: str,
    data: ClinicalNoteShareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    note_result = await db.execute(
        select(ClinicalNote).where(
            ClinicalNote.id == note_id,
            ClinicalNote.patient_id == patient.id,
        )
    )
    note = note_result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Historia clínica no encontrada")
    if not note.is_visible_to_patient:
        raise HTTPException(
            status_code=403,
            detail="No puedes compartir una nota que el profesional marcó como interna/no visible para ti."
        )

    note.shared_with_professionals = data.shared_with_professionals
    await db.commit()
    await db.refresh(note)

    prof_result = await db.execute(select(Professional).where(Professional.id == note.professional_id))
    professional = prof_result.scalar_one_or_none()

    logger.info(f"Paciente {patient.id} {'compartió' if data.shared_with_professionals else 'dejó de compartir'} nota {note_id}")
    return await _enrich(db, note, professional)


# ── GET /clinical-notes/consultation/{consultation_id} ──
# Devuelve la nota de una consulta específica, si el usuario tiene acceso:
# el médico que la escribió, o el paciente dueño (solo si es visible).
@router.get(
    "/consultation/{consultation_id}",
    response_model=ClinicalNoteResponse,
    summary="Obtener la historia clínica de una consulta específica"
)
async def get_note_by_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    note_result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.consultation_id == consultation_id)
    )
    note = note_result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Esta consulta no tiene historia clínica registrada")

    prof_result = await db.execute(select(Professional).where(Professional.id == note.professional_id))
    professional = prof_result.scalar_one_or_none()

    # ¿Es el médico que la escribió? Siempre puede verla.
    if professional and professional.user_id == current_user.id:
        return await _enrich(db, note, professional)

    # ¿Es el paciente dueño? Solo si está marcada visible para él.
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if patient and patient.id == note.patient_id:
        if not note.is_visible_to_patient:
            raise HTTPException(status_code=403, detail="Esta nota es interna del profesional y no está disponible para ti")
        return await _enrich(db, note, professional)

    raise HTTPException(status_code=403, detail="No tienes acceso a esta historia clínica")


# ── GET /clinical-notes/patient/my ───────────────────
# Todo el historial clínico del paciente logueado, marcado como visible
# para él. Es lo que usa el paciente para ver "mi historia clínica".
@router.get(
    "/patient/my",
    response_model=list[ClinicalNoteResponse],
    summary="[Paciente] Mi historia clínica completa (todas las consultas)"
)
async def get_my_clinical_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(ClinicalNote)
        .where(
            ClinicalNote.patient_id == patient.id,
            ClinicalNote.is_visible_to_patient == True,  # noqa: E712
        )
        .order_by(ClinicalNote.created_at.desc())
    )
    notes = result.scalars().all()
    return await _enrich_many(db, notes, patient=patient)


# ── GET /clinical-notes/patient/{patient_id}/mine ────
# Notas que YO (el profesional logueado) escribí para un paciente
# específico, sin importar la consulta. Pensado para que el médico pueda
# repasar su propio historial de ese paciente antes de atenderlo — por
# ejemplo, desde la cita agendada en el dashboard. A diferencia de
# "/shared", esto no depende de que el paciente haya activado nada: el
# médico siempre puede ver lo que él mismo escribió.
@router.get(
    "/patient/{patient_id}/mine",
    response_model=list[ClinicalNoteResponse],
    summary="[Profesional] Mis notas escritas para un paciente específico"
)
async def get_my_notes_for_patient(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = await _get_professional_or_403(current_user, db)

    pat_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = pat_result.scalar_one_or_none()

    result = await db.execute(
        select(ClinicalNote)
        .where(
            ClinicalNote.professional_id == professional.id,
            ClinicalNote.patient_id == patient_id,
        )
        .order_by(ClinicalNote.created_at.desc())
    )
    notes = result.scalars().all()
    return await _enrich_many(db, notes, professional=professional, patient=patient)


# ── GET /clinical-notes/patient/{patient_id}/shared ──
# Lo que usa un médico DISTINTO al que escribió la nota para ver el
# historial que el paciente decidió compartir con la plataforma — por
# ejemplo, al iniciar una nueva consulta con un médico diferente.
@router.get(
    "/patient/{patient_id}/shared",
    response_model=list[ClinicalNoteResponse],
    summary="[Profesional] Historia clínica que el paciente compartió con otros médicos"
)
async def get_patient_shared_history(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    await _get_professional_or_403(current_user, db)

    result = await db.execute(
        select(ClinicalNote)
        .where(
            ClinicalNote.patient_id == patient_id,
            ClinicalNote.shared_with_professionals == True,  # noqa: E712
            ClinicalNote.is_visible_to_patient == True,  # noqa: E712
        )
        .order_by(ClinicalNote.created_at.desc())
    )
    notes = result.scalars().all()
    return await _enrich_many(db, notes)


# ── GET /clinical-notes/my ────────────────────────────
# Todas las notas que el médico logueado escribió, para todos sus
# pacientes — por si el paciente vuelve a consultarlo, las puede revisar.
@router.get(
    "/my",
    response_model=list[ClinicalNoteResponse],
    summary="[Profesional] Mis notas clínicas escritas (todos mis pacientes)"
)
async def get_my_written_notes(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = await _get_professional_or_403(current_user, db)

    result = await db.execute(
        select(ClinicalNote)
        .where(ClinicalNote.professional_id == professional.id)
        .order_by(ClinicalNote.created_at.desc())
    )
    notes = result.scalars().all()
    return await _enrich_many(db, notes, professional=professional)