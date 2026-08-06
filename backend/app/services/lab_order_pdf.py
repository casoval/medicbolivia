"""
app/services/lab_order_pdf.py
Genera el PDF imprimible de una orden de laboratorio/imagenología
digital firmada — el paciente la presenta en el laboratorio de su
elección junto a su CI. Documento separado de prescription_pdf.py a
propósito (ver docstring de LabOrder en app/models/models.py: lo lee un
técnico de laboratorio, no un farmacéutico, y necesita datos que una
receta no — indicación clínica, ayuno, urgencia), pero comparte estilo,
firma, QR y lógica de matrícula con la receta vía app/services/pdf_common.py.

Igual que en prescription_pdf.py: este PDF no es la fuente de
autenticidad — lo es el hash SHA-256 + qr_verify_code que ya existen en
LabOrder (ver app/api/v1/endpoints/lab_orders.py). El QR de verificación
va bien visible, no como detalle chico.
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

VERIFY_BASE_URL = "https://medicbolivia.com/verificar-orden-lab"

URGENT_RED = colors.HexColor("#A32D2D")
URGENT_BG = colors.HexColor("#FBEAEA")
ROUTINE_GREEN = colors.HexColor("#0F6E56")
ROUTINE_BG = colors.HexColor("#E1F5EE")


def _verify_url(qr_verify_code: str) -> str:
    return f"{VERIFY_BASE_URL}?code={qr_verify_code}"


def _build_pdf_sync(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: list,
    professional_license_number: Optional[str], cmb_matricula: Optional[str], sedes_number: Optional[str],
    tests: list, clinical_indication: Optional[str], fasting_required: bool, urgency: str,
    instructions: Optional[str],
    digital_hash: str, qr_verify_code: str, signed_at,
    signature_bytes: Optional[bytes],
) -> bytes:
    """Igual patrón que prescription_pdf.py::_build_pdf_sync — CPU-bound,
    se corre en un thread aparte (ver generate_lab_order_pdf)."""
    qr_bytes = qr_png_bytes(_verify_url(qr_verify_code))
    matricula = matricula_label(professional_license_number, cmb_matricula)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        topMargin=1.3 * cm, bottomMargin=FOOTER_RESERVED_HEIGHT,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
    )

    s = build_styles()
    test_name_style = ParagraphStyle(
        "TestName", parent=s["body"], fontName="Helvetica-Bold", fontSize=9.8, textColor=INK,
    )
    test_note_style = ParagraphStyle(
        "TestNote", parent=s["body"], fontSize=8.8, textColor=MUTED, spaceAfter=2,
    )
    verify_label_style = ParagraphStyle(
        "VerifyLabel", parent=s["body"], fontName="Helvetica-Bold", fontSize=8.3, textColor=BRAND_BLUE,
    )
    verify_note_left_style = ParagraphStyle("VerifyNoteLeft", parent=s["verify_note"], alignment=TA_LEFT)
    code_left_style = ParagraphStyle("CodeLeft", parent=s["code"], alignment=TA_LEFT)
    badge_style = ParagraphStyle(
        "Badge", parent=s["body"], fontName="Helvetica-Bold", fontSize=8, alignment=TA_CENTER,
    )

    elements = []

    # ── Encabezado ──
    build_letterhead(
        elements, doc, s,
        "Orden de Laboratorio Digital",
        f"Emitida el {weekday_date_es(signed_at)} · medicbolivia.com",
    )

    # ── Franja médico / paciente ──
    specialty_line = specialty
    if sub_specialties:
        specialty_line += " · " + ", ".join(sub_specialties)

    doctor_cell = [
        Paragraph("MÉDICO SOLICITANTE", s["label"]),
        Paragraph(professional_name, s["value"]),
        Paragraph(specialty_line, s["value_sub"]),
        Paragraph(matricula, s["value_sub"]),
    ]
    if cmb_matricula and professional_license_number:
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

    # ── Datos de la orden: urgencia / ayuno — una sola línea, compacto ──
    is_urgent = (urgency or "ROUTINE").upper() == "URGENT"
    urgency_inline_style = ParagraphStyle(
        "UrgencyInline", parent=badge_style, alignment=TA_LEFT,
        textColor=(URGENT_RED if is_urgent else ROUTINE_GREEN),
    )
    fasting_text = "Sí, en ayunas" if fasting_required else "No requiere ayuno"

    info_table = Table(
        [[
            Paragraph("● " + ("URGENTE" if is_urgent else "RUTINA"), urgency_inline_style),
            Paragraph(f"<b>Ayuno:</b> {fasting_text}", s["body"]),
        ]],
        colWidths=[doc.width * 0.32, doc.width * 0.68],
    )
    info_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), URGENT_BG if is_urgent else ROUTINE_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(Spacer(1, 10))
    elements.append(info_table)

    if clinical_indication:
        elements.append(Paragraph("Indicación clínica", s["section"]))
        elements.append(Paragraph(clinical_indication, s["body"]))

    # ── Estudios solicitados ──
    elements.append(Paragraph("Estudios solicitados", s["section"]))
    test_rows = []
    for i, t in enumerate(tests, start=1):
        name = t.get("name", "")
        cell = [Paragraph(f"{i}. {name}", test_name_style)]
        if t.get("notes"):
            cell.append(Paragraph(t["notes"], test_note_style))
        test_rows.append([cell])

    if test_rows:
        test_table = Table(test_rows, colWidths=[doc.width])
        test_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.6, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        elements.append(test_table)

    if instructions:
        elements.append(Paragraph("Indicaciones adicionales", s["section"]))
        elements.append(Paragraph(instructions, s["body"]))

    # ── Firma, QR y aviso legal: fijos al pie de página (ver
    # draw_pinned_footer) — no van en `elements`, así que no importa
    # cuántos estudios tenga la orden: siempre quedan a la misma altura,
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
        matricula if (professional_license_number or cmb_matricula) else "Firma del médico solicitante",
        s["sig_sub"],
    ))
    sig_table = Table([[sig_cell]], colWidths=[doc.width])
    sig_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    footer_flowables.append(sig_table)

    if not signature_bytes:
        footer_flowables.append(Spacer(1, 4))
        footer_flowables.append(Paragraph(
            "Este médico aún no cargó su firma en MedicBolivia — la autenticidad de esta orden "
            "se confirma con el código QR de abajo, no depende de esta imagen.",
            s["warn"],
        ))

    footer_flowables.append(Spacer(1, 14))
    qr_img = Image(io.BytesIO(qr_bytes), width=2.6 * cm, height=2.6 * cm)
    verify_cell = [
        Paragraph("Verificación de autenticidad", verify_label_style),
        Paragraph(
            "Esta orden está firmada criptográficamente (SHA-256). Escanee el código o visite "
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
        "Documento generado por MedicBolivia. Esta es la orden/solicitud de estudios, no el "
        "resultado — preséntela junto a su cédula de identidad en el laboratorio o centro de "
        "imagenología de su elección.",
        s["footer"],
    ))

    doc.build(
        elements,
        onFirstPage=lambda c, d: draw_pinned_footer(c, d, footer_flowables),
        onLaterPages=lambda c, d: draw_pinned_footer(c, d, footer_flowables),
    )
    return buffer.getvalue()


async def generate_lab_order_pdf(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: Optional[list],
    professional_license_number: Optional[str], cmb_matricula: Optional[str], sedes_number: Optional[str],
    tests: list, clinical_indication: Optional[str], fasting_required: bool, urgency: str,
    instructions: Optional[str],
    digital_hash: str, qr_verify_code: str, signed_at,
    signature_url: Optional[str],
) -> bytes:
    """
    Arma el PDF imprimible de una orden de laboratorio ya firmada (hash y
    qr_verify_code ya generados por
    app/api/v1/endpoints/lab_orders.py::create_lab_order) y devuelve los
    bytes, listos para subir con
    app/services/storage.py::upload_lab_order_pdf_to_r2.
    Nunca lanza por un problema de la firma/logo — en el peor caso el PDF
    sale sin esa imagen, pero la orden se emite igual.
    """
    signature_bytes = await fetch_signature_bytes(signature_url)
    return await asyncio.to_thread(
        _build_pdf_sync,
        patient_name=patient_name, patient_ci=patient_ci, patient_age=patient_age,
        professional_name=professional_name, specialty=specialty,
        sub_specialties=sub_specialties or [],
        professional_license_number=professional_license_number,
        cmb_matricula=cmb_matricula, sedes_number=sedes_number,
        tests=tests, clinical_indication=clinical_indication,
        fasting_required=fasting_required, urgency=urgency, instructions=instructions,
        digital_hash=digital_hash, qr_verify_code=qr_verify_code, signed_at=signed_at,
        signature_bytes=signature_bytes,
    )
