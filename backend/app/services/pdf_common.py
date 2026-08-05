"""
app/services/pdf_common.py
Piezas compartidas entre app/services/prescription_pdf.py y
app/services/lab_order_pdf.py: son documentos legales separados a
propósito (ver docstring de LabOrder en app/models/models.py — los lee
gente distinta y tienen datos distintos), pero comparten look & feel,
firma del médico, QR de verificación y la lógica de qué matrícula
mostrar. Factorizado acá para que un ajuste de estilo o una corrección
de bug no diverja entre los dos documentos.
"""
import io
from pathlib import Path
from typing import Optional

import httpx
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from loguru import logger
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

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


def weekday_date_es(dt) -> str:
    return f"{dt.day} de {MONTHS_ES[dt.month - 1]} de {dt.year}"


def qr_png_bytes(url: str) -> bytes:
    qr = qrcode.QRCode(border=1, box_size=8, error_correction=ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#042C53", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def fetch_signature_bytes(signature_url: Optional[str]) -> Optional[bytes]:
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
        logger.warning(f"No se pudo descargar la firma del médico para el PDF: {e}")
        return None


def matricula_label(
    professional_license_number: Optional[str],
    cmb_matricula: Optional[str],
    *, unset_text: str = "no registrada en el perfil",
) -> str:
    """
    La matrícula profesional del Ministerio de Salud es el dato "oficial"
    desde que se retiró la verificación CMB de la plataforma (ver DocType
    en app/models/models.py). cmb_matricula queda solo como respaldo para
    médicos que se registraron antes de este cambio y todavía no cargaron
    su matrícula nueva en el perfil — nunca se muestran mezcladas bajo la
    misma etiqueta porque son registros de entidades distintas (Ministerio
    de Salud vs. Colegio Médico).
    """
    if professional_license_number:
        return f"Matrícula profesional: {professional_license_number}"
    if cmb_matricula:
        return f"Matrícula CMB: {cmb_matricula}"
    return f"Matrícula profesional: {unset_text}"


def build_styles() -> dict:
    """Estilos de párrafo comunes a ambos documentos. Cada PDF puede
    agregar los suyos propios además de estos (ver section_style/med_name_style
    en prescription_pdf.py vs. su equivalente en lab_order_pdf.py)."""
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title", parent=styles["Heading1"], fontName="Helvetica-Bold",
            fontSize=14, textColor=BRAND_BLUE, alignment=TA_CENTER, spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", parent=styles["Normal"], fontName="Helvetica",
            fontSize=8.8, textColor=MUTED, alignment=TA_CENTER, spaceAfter=10,
        ),
        "label": ParagraphStyle(
            "Label", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=7.6, textColor=colors.white, alignment=TA_LEFT,
        ),
        "value": ParagraphStyle(
            "Value", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=10.3, textColor=colors.white, alignment=TA_LEFT, spaceAfter=1,
        ),
        "value_sub": ParagraphStyle(
            "ValueSub", parent=styles["Normal"], fontName="Helvetica",
            fontSize=8.8, textColor=colors.white, alignment=TA_LEFT,
        ),
        "section": ParagraphStyle(
            "Section", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=10, textColor=BRAND_BLUE, alignment=TA_LEFT, spaceBefore=10, spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body", parent=styles["Normal"], fontName="Helvetica",
            fontSize=8.8, textColor=INK, alignment=TA_LEFT, leading=12.5,
        ),
        "warn": ParagraphStyle(
            "Warn", parent=styles["Normal"], fontName="Helvetica-Oblique",
            fontSize=8.3, textColor=WARN, alignment=TA_LEFT,
        ),
        "sig_name": ParagraphStyle(
            "SigName", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=9.7, textColor=INK, alignment=TA_CENTER, spaceAfter=1,
        ),
        "sig_sub": ParagraphStyle(
            "SigSub", parent=styles["Normal"], fontName="Helvetica",
            fontSize=8, textColor=MUTED, alignment=TA_CENTER,
        ),
        "footer": ParagraphStyle(
            "Footer", parent=styles["Normal"], fontName="Helvetica",
            fontSize=7.3, textColor=MUTED, alignment=TA_CENTER,
        ),
        "code": ParagraphStyle(
            "Code", parent=styles["Normal"], fontName="Courier",
            fontSize=7.6, textColor=DARK_HEADER, alignment=TA_CENTER,
        ),
        "verify_note": ParagraphStyle(
            "VerifyNote", parent=styles["Normal"], fontName="Helvetica",
            fontSize=7.8, textColor=MUTED, alignment=TA_CENTER, leading=11,
        ),
    }
