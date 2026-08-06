"""
app/services/prescription_pdf.py
Genera el PDF imprimible de una receta digital firmada — pensado para las
farmacias bolivianas que todavía piden "el papel" además de (o en vez de)
verificar el QR. Piezas compartidas con lab_order_pdf.py factorizadas en
app/services/pdf_common.py (mismo look & feel, firma, QR y lógica de
matrícula — ver docstring de ese módulo).

Importante: este documento NO es la fuente de autenticidad de la receta.
La autenticidad real la da el hash SHA-256 + qr_verify_code que ya existen
en Prescription (ver app/api/v1/endpoints/prescriptions.py) — cualquiera
podría recortar la imagen de firma de un PDF y pegarla en otro. Por eso
el QR de verificación va bien visible en el documento, no como detalle
chico: es el mecanismo real, la firma/matrícula son para que un
farmacéutico lo reconozca a simple vista, como está acostumbrado.

La firma del médico (Professional.signature_url) es una imagen (PNG,
trazo sobre fondo transparente, capturada en un canvas desde su perfil —
ver POST /professionals/signature), NO una firma digital criptográfica.
Es opcional: si el médico todavía no la cargó, el PDF se genera igual,
solo sin esa imagen — nunca bloquea la emisión de la receta ni el resto
del flujo de la consulta.
"""
import asyncio
import io
from typing import Optional

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, HRFlowable,
)

from app.services.pdf_common import (
    LOGO_PATH, BRAND_BLUE, DARK_HEADER, INK, MUTED, BORDER,
    weekday_date_es, qr_png_bytes, fetch_signature_bytes, matricula_label, build_styles, build_letterhead,
    FOOTER_RESERVED_HEIGHT, draw_pinned_footer,
)

# Mismo origen que build...VerifyUrl() en frontend/src/lib/api.ts — acá no
# hay window.location, así que se hardcodea el dominio de producción, igual
# que ya se hace con CONTACT_EMAIL en invitation_pdf.py.
VERIFY_BASE_URL = "https://medicbolivia.com/verificar-receta"


def _verify_url(qr_verify_code: str) -> str:
    return f"{VERIFY_BASE_URL}?code={qr_verify_code}"


def _build_pdf_sync(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: list,
    professional_license_number: Optional[str], cmb_matricula: Optional[str], sedes_number: Optional[str],
    medications: list, instructions: Optional[str],
    digital_hash: str, qr_verify_code: str, signed_at,
    signature_bytes: Optional[bytes],
) -> bytes:
    """Parte CPU-bound (QR + reportlab): corre en un thread aparte (ver
    generate_prescription_pdf) para no bloquear el event loop mientras un
    médico emite una receta en medio de una videollamada en curso de
    algún otro profesional."""
    qr_bytes = qr_png_bytes(_verify_url(qr_verify_code))
    matricula = matricula_label(professional_license_number, cmb_matricula)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        topMargin=1.3 * cm, bottomMargin=FOOTER_RESERVED_HEIGHT,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
    )

    s = build_styles()
    med_name_style = ParagraphStyle(
        "MedName", parent=s["body"], fontName="Helvetica-Bold", fontSize=9.8, textColor=INK,
    )
    med_detail_style = ParagraphStyle(
        "MedDetail", parent=s["body"], fontSize=8.8, textColor=MUTED, spaceAfter=2,
    )
    verify_label_style = ParagraphStyle(
        "VerifyLabel", parent=s["body"], fontName="Helvetica-Bold", fontSize=8.3, textColor=BRAND_BLUE,
    )
    verify_note_left_style = ParagraphStyle("VerifyNoteLeft", parent=s["verify_note"], alignment=TA_LEFT)
    code_left_style = ParagraphStyle("CodeLeft", parent=s["code"], alignment=TA_LEFT)

    elements = []

    # ── Encabezado ──
    build_letterhead(
        elements, doc, s,
        "Receta Médica Digital",
        f"Emitida el {weekday_date_es(signed_at)} · medicbolivia.com",
    )

    # ── Franja médico / paciente ──
    specialty_line = specialty
    if sub_specialties:
        specialty_line += " · " + ", ".join(sub_specialties)

    doctor_cell = [
        Paragraph("MÉDICO TRATANTE", s["label"]),
        Paragraph(professional_name, s["value"]),
        Paragraph(specialty_line, s["value_sub"]),
        Paragraph(matricula, s["value_sub"]),
    ]
    if cmb_matricula and professional_license_number:
        # Caso de transición: tiene ambas, se muestra la nueva como línea
        # principal (ya incluida en `matricula`) y la CMB como referencia
        # adicional — no reemplaza, es informativo mientras el médico
        # termina de migrar sus datos.
        doctor_cell.append(Paragraph(f"Matrícula CMB: {cmb_matricula}", s["value_sub"]))
    if sedes_number:
        doctor_cell.append(Paragraph(f"SEDES: {sedes_number}", s["value_sub"]))

    patient_cell = [
        Paragraph("PACIENTE", s["label"]),
        Paragraph(patient_name, s["value"]),
        Paragraph(f"CI: {patient_ci}", s["value_sub"]),
        Paragraph(f"{patient_age} años", s["value_sub"]),
    ]

    header_table = Table([[doctor_cell, patient_cell]], colWidths=[doc.width * 0.62, doc.width * 0.38])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK_HEADER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 12), ("RIGHTPADDING", (0, 0), (0, 0), 8),
        ("LEFTPADDING", (1, 0), (1, 0), 8), ("RIGHTPADDING", (1, 0), (1, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(header_table)

    # ── Medicamentos (Rp.) ──
    elements.append(Paragraph("Rp. / Medicamentos prescritos", s["section"]))
    med_rows = []
    for i, m in enumerate(medications, start=1):
        name = m.get("name", "")
        presentation = m.get("presentation")
        parts = [p for p in [m.get("dosage"), m.get("frequency"), m.get("duration")] if p]
        detail_line = "  ·  ".join(parts)
        cell = [Paragraph(f"{i}. {name}" + (f" — {presentation}" if presentation else ""), med_name_style)]
        if detail_line:
            cell.append(Paragraph(detail_line, med_detail_style))
        if m.get("notes"):
            cell.append(Paragraph(m["notes"], med_detail_style))
        med_rows.append([cell])

    if med_rows:
        med_table = Table(med_rows, colWidths=[doc.width])
        med_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.6, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        elements.append(med_table)

    if instructions:
        elements.append(Paragraph("Indicaciones del médico", s["section"]))
        elements.append(Paragraph(instructions, s["body"]))

    # ── Firma, QR y aviso legal: fijos al pie de página (ver
    # draw_pinned_footer) — no van en `elements`, así que no importa si la
    # receta tiene 1 medicamento o 10: siempre quedan a la misma altura,
    # pegados abajo, en vez de "flotar" a media hoja cuando hay poco
    # contenido arriba.
    footer_flowables = []
    sig_cell = []
    if signature_bytes:
        try:
            sig_img = Image(io.BytesIO(signature_bytes), width=3.6 * cm, height=1.8 * cm, kind="proportional")
            sig_img.hAlign = "CENTER"
            sig_cell.append(sig_img)
        except Exception as e:
            from loguru import logger
            logger.warning(f"Imagen de firma inválida, se omite del PDF: {e}")
    sig_cell.append(HRFlowable(width=5.5 * cm, thickness=0.6, color=colors.HexColor("#A0A8BF"), hAlign="CENTER"))
    sig_cell.append(Spacer(1, 3))
    sig_cell.append(Paragraph(professional_name, s["sig_name"]))
    sig_cell.append(Paragraph(
        matricula if (professional_license_number or cmb_matricula) else "Firma del médico tratante",
        s["sig_sub"],
    ))
    sig_table = Table([[sig_cell]], colWidths=[doc.width])
    sig_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    footer_flowables.append(sig_table)

    if not signature_bytes:
        footer_flowables.append(Spacer(1, 4))
        footer_flowables.append(Paragraph(
            "Este médico aún no cargó su firma en MedicBolivia — la autenticidad de esta receta "
            "se confirma con el código QR de abajo, no depende de esta imagen.",
            s["warn"],
        ))

    footer_flowables.append(Spacer(1, 14))
    qr_img = Image(io.BytesIO(qr_bytes), width=2.6 * cm, height=2.6 * cm)
    verify_cell = [
        Paragraph("Verificación de autenticidad", verify_label_style),
        Paragraph(
            "Esta receta está firmada criptográficamente (SHA-256). Escanee el código o visite "
            f"{VERIFY_BASE_URL} e ingrese el código para confirmar que es auténtica y sigue vigente "
            "(no anulada).",
            verify_note_left_style,
        ),
        Spacer(1, 4),
        Paragraph(qr_verify_code, code_left_style),
    ]
    verify_table = Table([[qr_img, verify_cell]], colWidths=[3.2 * cm, doc.width - 3.2 * cm])
    verify_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    footer_flowables.append(verify_table)

    footer_flowables.append(Spacer(1, 8))
    footer_flowables.append(HRFlowable(width="100%", thickness=0.6, color=BORDER))
    footer_flowables.append(Spacer(1, 4))
    footer_flowables.append(Paragraph(
        "Documento generado por MedicBolivia. Los medicamentos controlados (psicotrópicos o "
        "estupefacientes) requieren receta oficial archivada/valorada conforme a normativa de "
        "AGEMED y no se emiten por esta plataforma.",
        s["footer"],
    ))

    doc.build(
        elements,
        onFirstPage=lambda c, d: draw_pinned_footer(c, d, footer_flowables),
        onLaterPages=lambda c, d: draw_pinned_footer(c, d, footer_flowables),
    )
    return buffer.getvalue()


async def generate_prescription_pdf(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: Optional[list],
    professional_license_number: Optional[str], cmb_matricula: Optional[str], sedes_number: Optional[str],
    medications: list, instructions: Optional[str],
    digital_hash: str, qr_verify_code: str, signed_at,
    signature_url: Optional[str],
) -> bytes:
    """
    Arma el PDF imprimible de una receta ya firmada (hash y qr_verify_code
    ya generados por app/api/v1/endpoints/prescriptions.py::create_prescription)
    y devuelve los bytes, listos para subir con
    app/services/storage.py::upload_prescription_pdf_to_r2.
    Nunca lanza por un problema de la firma/logo — en el peor caso el PDF
    sale sin esa imagen, pero la receta se emite igual.
    """
    signature_bytes = await fetch_signature_bytes(signature_url)
    return await asyncio.to_thread(
        _build_pdf_sync,
        patient_name=patient_name, patient_ci=patient_ci, patient_age=patient_age,
        professional_name=professional_name, specialty=specialty,
        sub_specialties=sub_specialties or [],
        professional_license_number=professional_license_number,
        cmb_matricula=cmb_matricula, sedes_number=sedes_number,
        medications=medications, instructions=instructions,
        digital_hash=digital_hash, qr_verify_code=qr_verify_code, signed_at=signed_at,
        signature_bytes=signature_bytes,
    )
