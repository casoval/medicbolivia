"""
app/services/prescription_pdf.py
Genera el PDF imprimible de una receta digital firmada — pensado para las
farmacias bolivianas que todavía piden "el papel" además de (o en vez de)
verificar el QR. Mismo patrón de reportlab que app/services/invitation_pdf.py.

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
from pathlib import Path
from typing import Optional

import httpx
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from loguru import logger
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, HRFlowable,
)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
LOGO_PATH = ASSETS_DIR / "logo.png"

BRAND_BLUE = colors.HexColor("#185FA5")
DARK_HEADER = colors.HexColor("#042C53")
INK = colors.HexColor("#141820")
MUTED = colors.HexColor("#6B738A")
WARN = colors.HexColor("#854F0B")
BORDER = colors.HexColor("#DDE1EE")

MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# Mismo origen que build...VerifyUrl() en frontend/src/lib/api.ts — acá no
# hay window.location, así que se hardcodea el dominio de producción, igual
# que ya se hace con CONTACT_EMAIL en invitation_pdf.py.
VERIFY_BASE_URL = "https://medicbolivia.com/verificar-receta"


def _verify_url(qr_verify_code: str) -> str:
    return f"{VERIFY_BASE_URL}?code={qr_verify_code}"


def _weekday_date_es(dt) -> str:
    return f"{dt.day} de {MONTHS_ES[dt.month - 1]} de {dt.year}"


def _qr_png_bytes(url: str) -> bytes:
    qr = qrcode.QRCode(border=1, box_size=8, error_correction=ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#042C53", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _fetch_signature_bytes(signature_url: Optional[str]) -> Optional[bytes]:
    """
    Descarga la imagen de firma (URL pública) para incrustarla en el PDF.
    Nunca lanza: si falla (médico sin firma cargada, timeout, etc.) el PDF
    se arma igual, solo sin esa imagen.
    """
    if not signature_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(signature_url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.warning(f"No se pudo descargar la firma del médico para el PDF de receta: {e}")
        return None


def _build_pdf_sync(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: list,
    cmb_matricula: Optional[str], sedes_number: Optional[str],
    medications: list, instructions: Optional[str],
    digital_hash: str, qr_verify_code: str, signed_at,
    signature_bytes: Optional[bytes],
) -> bytes:
    """Parte CPU-bound (QR + reportlab): corre en un thread aparte (ver
    generate_prescription_pdf) para no bloquear el event loop mientras un
    médico emite una receta en medio de una videollamada en curso de
    algún otro profesional."""
    qr_bytes = _qr_png_bytes(_verify_url(qr_verify_code))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        topMargin=1.3 * cm, bottomMargin=1.3 * cm,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=14, textColor=BRAND_BLUE, alignment=TA_CENTER, spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8.8, textColor=MUTED, alignment=TA_CENTER, spaceAfter=10,
    )
    label_style = ParagraphStyle(
        "Label", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=7.6, textColor=colors.white, alignment=TA_LEFT,
    )
    value_style = ParagraphStyle(
        "Value", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10.3, textColor=colors.white, alignment=TA_LEFT, spaceAfter=1,
    )
    value_sub_style = ParagraphStyle(
        "ValueSub", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8.8, textColor=colors.white, alignment=TA_LEFT,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10, textColor=BRAND_BLUE, alignment=TA_LEFT, spaceBefore=10, spaceAfter=6,
    )
    med_name_style = ParagraphStyle(
        "MedName", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=9.8, textColor=INK, alignment=TA_LEFT,
    )
    med_detail_style = ParagraphStyle(
        "MedDetail", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8.8, textColor=MUTED, alignment=TA_LEFT, spaceAfter=2,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8.8, textColor=INK, alignment=TA_LEFT, leading=12.5,
    )
    warn_style = ParagraphStyle(
        "Warn", parent=styles["Normal"], fontName="Helvetica-Oblique",
        fontSize=8.3, textColor=WARN, alignment=TA_LEFT,
    )
    sig_name_style = ParagraphStyle(
        "SigName", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=9.7, textColor=INK, alignment=TA_CENTER, spaceAfter=1,
    )
    sig_sub_style = ParagraphStyle(
        "SigSub", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8, textColor=MUTED, alignment=TA_CENTER,
    )
    footer_style = ParagraphStyle(
        "Footer", parent=styles["Normal"], fontName="Helvetica",
        fontSize=7.3, textColor=MUTED, alignment=TA_CENTER,
    )
    code_style = ParagraphStyle(
        "Code", parent=styles["Normal"], fontName="Courier",
        fontSize=7.6, textColor=DARK_HEADER, alignment=TA_CENTER,
    )
    verify_note_style = ParagraphStyle(
        "VerifyNote", parent=styles["Normal"], fontName="Helvetica",
        fontSize=7.8, textColor=MUTED, alignment=TA_CENTER, leading=11,
    )

    elements = []

    # ── Encabezado ──
    if LOGO_PATH.exists():
        logo = Image(str(LOGO_PATH), width=4.2 * cm, height=4.2 * cm * (339 / 1779))
        logo.hAlign = "CENTER"
        elements.append(logo)
        elements.append(Spacer(1, 6))
    elements.append(Paragraph("Receta Médica Digital", title_style))
    elements.append(Paragraph(f"Emitida el {_weekday_date_es(signed_at)} · medicbolivia.com", subtitle_style))

    # ── Franja médico / paciente ──
    specialty_line = specialty
    if sub_specialties:
        specialty_line += " · " + ", ".join(sub_specialties)

    doctor_cell = [
        Paragraph("MÉDICO TRATANTE", label_style),
        Paragraph(professional_name, value_style),
        Paragraph(specialty_line, value_sub_style),
    ]
    if cmb_matricula:
        doctor_cell.append(Paragraph(f"Matrícula CMB: {cmb_matricula}", value_sub_style))
    else:
        doctor_cell.append(Paragraph("Matrícula CMB: no registrada en el perfil", value_sub_style))
    if sedes_number:
        doctor_cell.append(Paragraph(f"SEDES: {sedes_number}", value_sub_style))

    patient_cell = [
        Paragraph("PACIENTE", label_style),
        Paragraph(patient_name, value_style),
        Paragraph(f"CI: {patient_ci}", value_sub_style),
        Paragraph(f"{patient_age} años", value_sub_style),
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
    elements.append(Paragraph("Rp. / Medicamentos prescritos", section_style))
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
        elements.append(Paragraph("Indicaciones del médico", section_style))
        elements.append(Paragraph(instructions, body_style))

    # ── Firma ──
    elements.append(Spacer(1, 18))
    sig_cell = []
    if signature_bytes:
        try:
            sig_img = Image(io.BytesIO(signature_bytes), width=3.6 * cm, height=1.8 * cm, kind="proportional")
            sig_img.hAlign = "CENTER"
            sig_cell.append(sig_img)
        except Exception as e:
            logger.warning(f"Imagen de firma inválida, se omite del PDF: {e}")
    sig_cell.append(HRFlowable(width=5.5 * cm, thickness=0.6, color=colors.HexColor("#A0A8BF"), hAlign="CENTER"))
    sig_cell.append(Spacer(1, 3))
    sig_cell.append(Paragraph(professional_name, sig_name_style))
    sig_cell.append(Paragraph(
        f"Matrícula CMB: {cmb_matricula}" if cmb_matricula else "Firma del médico tratante",
        sig_sub_style,
    ))
    sig_table = Table([[sig_cell]], colWidths=[doc.width])
    sig_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    elements.append(sig_table)

    if not signature_bytes:
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(
            "Este médico aún no cargó su firma en MedicBolivia — la autenticidad de esta receta "
            "se confirma con el código QR de abajo, no depende de esta imagen.",
            warn_style,
        ))

    # ── Verificación ──
    elements.append(Spacer(1, 16))
    verify_label_style = ParagraphStyle(
        "VerifyLabel", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=8.3, textColor=BRAND_BLUE, alignment=TA_LEFT,
    )
    verify_note_left_style = ParagraphStyle(
        "VerifyNoteLeft", parent=verify_note_style, alignment=TA_LEFT,
    )
    code_left_style = ParagraphStyle(
        "CodeLeft", parent=code_style, alignment=TA_LEFT,
    )

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
    elements.append(verify_table)

    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=0.6, color=BORDER))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        "Documento generado por MedicBolivia. Los medicamentos controlados (psicotrópicos o "
        "estupefacientes) requieren receta oficial archivada/valorada conforme a normativa de "
        "AGEMED y no se emiten por esta plataforma.",
        footer_style,
    ))

    doc.build(elements)
    return buffer.getvalue()


async def generate_prescription_pdf(
    *,
    patient_name: str, patient_ci: str, patient_age: int,
    professional_name: str, specialty: str, sub_specialties: Optional[list],
    cmb_matricula: Optional[str], sedes_number: Optional[str],
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
    signature_bytes = await _fetch_signature_bytes(signature_url)
    return await asyncio.to_thread(
        _build_pdf_sync,
        patient_name=patient_name, patient_ci=patient_ci, patient_age=patient_age,
        professional_name=professional_name, specialty=specialty,
        sub_specialties=sub_specialties or [],
        cmb_matricula=cmb_matricula, sedes_number=sedes_number,
        medications=medications, instructions=instructions,
        digital_hash=digital_hash, qr_verify_code=qr_verify_code, signed_at=signed_at,
        signature_bytes=signature_bytes,
    )
