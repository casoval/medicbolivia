"""
app/services/invitation_pdf.py
Genera el PDF de invitación formal que se adjunta al mensaje de WhatsApp
cuando el admin invita a un prospecto (ver
app/api/v1/endpoints/admin.py::invite_doctor_lead). Un documento de una
página: logo, saludo personalizado con el nombre del médico, descripción
breve de la plataforma, y firma del director médico.

Assets usados (ver app/assets/):
  - logo.png                 → mismo logo que frontend/public/logo.png
  - director_signature.png   → firma escaneada, procesada con fondo
                                transparente (ver git log de este archivo
                                para el script de procesamiento original)

Datos del director médico están hardcodeados acá a propósito: cambiar de
director es un evento raro y manual, no vale la pena una tabla de
configuración para esto — si cambia, se edita este archivo.
"""
import io
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, HRFlowable,
)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
LOGO_PATH = ASSETS_DIR / "logo.png"
SIGNATURE_PATH = ASSETS_DIR / "director_signature.png"

DIRECTOR_NAME = "Dr. Javier Francisco Castro Ayllón"
DIRECTOR_TITLE = "Director Médico — MedicBolivia"
DIRECTOR_REGISTRY = "M.P. C-933"

BRAND_BLUE = colors.HexColor("#185FA5")
INK = colors.HexColor("#141820")
MUTED = colors.HexColor("#6B738A")

MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _greeting_name(full_name: str) -> str:
    """
    'Dr. Jorge Luis Vargas B. - Cardiólogo - Electrocardiograma...' → 'Dr. Jorge Luis Vargas B.'
    Muchos leads importados desde Google Places traen el nombre del
    negocio pegado con sus servicios separados por " - "; para el saludo
    del PDF solo queremos la primera parte.
    """
    return full_name.split(" - ")[0].strip()


def generate_invitation_pdf(doctor_name: str) -> bytes:
    """
    Arma el PDF de invitación personalizado y devuelve los bytes listos
    para adjuntar (ver app/tasks/whatsapp_tasks.py::send_whatsapp_document).
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        topMargin=1.8 * cm, bottomMargin=1.8 * cm,
        leftMargin=2.2 * cm, rightMargin=2.2 * cm,
    )

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=10.5, leading=16, textColor=INK, alignment=TA_JUSTIFY,
        spaceAfter=10,
    )
    greeting_style = ParagraphStyle(
        "Greeting", parent=body_style, fontSize=11, spaceAfter=14, alignment=TA_JUSTIFY,
    )
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=16, textColor=BRAND_BLUE, alignment=TA_CENTER, spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9.5, textColor=MUTED, alignment=TA_CENTER, spaceAfter=18,
    )
    signature_name_style = ParagraphStyle(
        "SigName", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10.5, textColor=INK, spaceAfter=1,
    )
    signature_sub_style = ParagraphStyle(
        "SigSub", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9, textColor=MUTED,
    )
    footer_style = ParagraphStyle(
        "Footer", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8, textColor=MUTED, alignment=TA_CENTER,
    )

    today = datetime.now()
    fecha_es = f"{today.day} de {MONTHS_ES[today.month - 1]} de {today.year}"

    elements = []

    # ── Encabezado: logo ──
    if LOGO_PATH.exists():
        logo = Image(str(LOGO_PATH), width=8 * cm, height=8 * cm * (339 / 1779))
        logo.hAlign = "CENTER"
        elements.append(logo)
        elements.append(Spacer(1, 14))

    elements.append(Paragraph("Invitación a unirse a MedicBolivia", title_style))
    elements.append(Paragraph("Tu atención médica, donde estés", subtitle_style))
    elements.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#DDE1EE")))
    elements.append(Spacer(1, 16))

    elements.append(Paragraph(fecha_es, footer_style))
    elements.append(Spacer(1, 10))

    name = _greeting_name(doctor_name)
    elements.append(Paragraph(f"Estimado/a {name},", greeting_style))

    elements.append(Paragraph(
        "Es un gusto dirigirme a usted en nombre de MedicBolivia, una plataforma boliviana de "
        "telemedicina que conecta a médicos y pacientes de todo el país a través de consultas "
        "en línea, con el respaldo de herramientas pensadas para el ejercicio profesional: "
        "agenda propia, historial clínico digital, recetas y notas clínicas electrónicas, y "
        "pagos gestionados por la plataforma.",
        body_style,
    ))
    elements.append(Paragraph(
        "Quisiéramos invitarle a conocer MedicBolivia y probarla sin costo. Nuestro objetivo es "
        "que usted pueda ampliar su alcance y atender a más pacientes —incluyendo a quienes "
        "viven lejos de su consultorio— sin que eso implique una carga administrativa adicional "
        "para usted ni para su equipo.",
        body_style,
    ))
    elements.append(Paragraph(
        "Si desea conocer más detalles o coordinar una breve llamada de presentación, con gusto "
        "quedamos a su disposición a través de este mismo número de WhatsApp.",
        body_style,
    ))

    elements.append(Spacer(1, 26))
    elements.append(Paragraph("Cordialmente,", body_style))
    elements.append(Spacer(1, 4))

    # ── Firma ──
    sig_cell = []
    if SIGNATURE_PATH.exists():
        sig_img = Image(str(SIGNATURE_PATH), width=4.2 * cm, height=4.2 * cm * (643 / 916))
        sig_cell.append(sig_img)
    sig_cell.append(HRFlowable(width=4.2 * cm, thickness=0.6, color=colors.HexColor("#A0A8BF")))
    sig_cell.append(Spacer(1, 2))
    sig_cell.append(Paragraph(DIRECTOR_NAME, signature_name_style))
    sig_cell.append(Paragraph(DIRECTOR_TITLE, signature_sub_style))
    sig_cell.append(Paragraph(DIRECTOR_REGISTRY, signature_sub_style))

    table = Table([[sig_cell]], colWidths=[7 * cm])
    table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(table)

    elements.append(Spacer(1, 30))
    elements.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#DDE1EE")))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph("medicbolivia.com", footer_style))

    doc.build(elements)
    return buffer.getvalue()
