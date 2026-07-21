"""
app/services/invitation_pdf.py
Genera el PDF de invitación formal que se adjunta al mensaje de WhatsApp
cuando el admin invita a un prospecto (ver
app/api/v1/endpoints/admin.py::invite_doctor_lead). Un documento de una
página: logo, saludo personalizado con el nombre del médico, descripción
de la plataforma, respaldo de verificación médica, y firma del director
médico (centrada).

Assets usados (ver app/assets/):
  - logo.png                 → mismo logo que frontend/public/logo.png
  - director_signature.png   → firma escaneada. El archivo original traía
                                el trazo codificado como un canal alfa
                                invertido (fondo 100% opaco azul marino,
                                firma en baja opacidad) — quedó procesado
                                invirtiendo el alfa para que el trazo sea
                                tinta opaca sobre fondo transparente. Si se
                                reemplaza este archivo por una firma nueva,
                                confirmar que sea PNG con canal alfa recto
                                (fondo transparente de verdad), no invertido.

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
CONTACT_EMAIL = "info@medicbolivia.com"

BRAND_BLUE = colors.HexColor("#185FA5")
INK = colors.HexColor("#141820")
MUTED = colors.HexColor("#6B738A")

MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# Beneficios para el profesional, en formato de bullets compactos (se
# renderizan como un único Paragraph con <br/> para ahorrar espacio
# vertical frente a usar un flowable por línea).
BENEFITS = [
    "Agentes de inteligencia artificial que reciben, orientan y conectan al paciente con usted, "
    "las 24 horas — el paciente nunca llega \"en frío\".",
    "Usted define sus propios horarios de atención y sus propias tarifas: la plataforma no le "
    "impone precios ni disponibilidad.",
    "Recordatorios automáticos por WhatsApp, tanto para el paciente como para usted, para reducir "
    "inasistencias.",
    "El paciente puede llamar al agente IA para resolver dudas antes o después de la consulta, "
    "sin ocupar su tiempo directo.",
    "Historial clínico, recetas y notas médicas digitales, y pagos gestionados por la plataforma "
    "de principio a fin.",
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
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        leftMargin=2 * cm, rightMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9.7, leading=13.5, textColor=INK, alignment=TA_JUSTIFY,
        spaceAfter=7,
    )
    greeting_style = ParagraphStyle(
        "Greeting", parent=body_style, fontSize=10.3, spaceAfter=8, alignment=TA_JUSTIFY,
    )
    bullets_style = ParagraphStyle(
        "Bullets", parent=body_style, fontSize=9.3, leading=13, spaceAfter=7,
    )
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=15.5, textColor=BRAND_BLUE, alignment=TA_CENTER, spaceAfter=3,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9.3, textColor=MUTED, alignment=TA_CENTER, spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10, textColor=BRAND_BLUE, alignment=TA_JUSTIFY, spaceBefore=2, spaceAfter=5,
    )
    signature_name_style = ParagraphStyle(
        "SigName", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10.3, textColor=INK, alignment=TA_CENTER, spaceAfter=1,
    )
    signature_sub_style = ParagraphStyle(
        "SigSub", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8.8, textColor=MUTED, alignment=TA_CENTER,
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
        logo = Image(str(LOGO_PATH), width=7 * cm, height=7 * cm * (339 / 1779))
        logo.hAlign = "CENTER"
        elements.append(logo)
        elements.append(Spacer(1, 10))

    elements.append(Paragraph("Invitación a unirse a MedicBolivia", title_style))
    elements.append(Paragraph("Telemedicina boliviana, potenciada con IA", subtitle_style))
    elements.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#DDE1EE")))
    elements.append(Spacer(1, 12))

    elements.append(Paragraph(fecha_es, footer_style))
    elements.append(Spacer(1, 8))

    name = _greeting_name(doctor_name)
    elements.append(Paragraph(f"Estimado/a {name},", greeting_style))

    elements.append(Paragraph(
        "Le escribimos de MedicBolivia, una plataforma boliviana de telemedicina donde agentes de "
        "inteligencia artificial se encargan de recibir, orientar y conectar al paciente con el "
        "profesional adecuado. Nuestro objetivo es simple: que usted pueda atender a más pacientes "
        "—incluyendo a quienes viven lejos de su consultorio— con el menor esfuerzo administrativo "
        "posible. Quisiéramos invitarle a probarla sin costo.",
        body_style,
    ))

    elements.append(Paragraph("¿Qué encuentra al unirse?", section_style))
    bullets_html = "<br/>".join(f"•&nbsp;&nbsp;{b}" for b in BENEFITS)
    elements.append(Paragraph(bullets_html, bullets_style))

    elements.append(Paragraph("Una red de médicos verificados", section_style))
    elements.append(Paragraph(
        "En MedicBolivia solo ejercen médicos certificados que cumplen con los requisitos "
        "establecidos en Bolivia para el ejercicio de la medicina. Esa verificación no la hace "
        "solo un equipo técnico: contamos con un equipo médico con más de 31 años de experiencia "
        "combinada que revisa y respalda cada acreditación — para que tanto usted como sus "
        "pacientes confíen en la seriedad de la plataforma.",
        body_style,
    ))

    elements.append(Paragraph(
        f"Sumarse no le cuesta nada y no le compromete a nada: usted conserva sus tarifas y sus "
        f"horarios. Si desea conocer más detalles o coordinar una breve llamada de presentación, "
        f"quedamos a su disposición por este mismo WhatsApp o al correo {CONTACT_EMAIL}.",
        body_style,
    ))

    elements.append(Spacer(1, 16))
    elements.append(Paragraph("Cordialmente,", body_style))
    elements.append(Spacer(1, 4))

    # ── Firma (centrada) ──
    sig_cell = []
    if SIGNATURE_PATH.exists():
        sig_img = Image(str(SIGNATURE_PATH), width=3.8 * cm, height=3.8 * cm * (643 / 916))
        sig_img.hAlign = "CENTER"
        sig_cell.append(sig_img)
    sig_cell.append(HRFlowable(width=4.5 * cm, thickness=0.6, color=colors.HexColor("#A0A8BF"), hAlign="CENTER"))
    sig_cell.append(Spacer(1, 3))
    sig_cell.append(Paragraph(DIRECTOR_NAME, signature_name_style))
    sig_cell.append(Paragraph(DIRECTOR_TITLE, signature_sub_style))
    sig_cell.append(Paragraph(DIRECTOR_REGISTRY, signature_sub_style))

    table = Table([[sig_cell]], colWidths=[doc.width])
    table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(table)

    elements.append(Spacer(1, 14))
    elements.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#DDE1EE")))
    elements.append(Spacer(1, 5))
    elements.append(Paragraph(f"medicbolivia.com &nbsp;·&nbsp; {CONTACT_EMAIL}", footer_style))

    doc.build(elements)
    return buffer.getvalue()
