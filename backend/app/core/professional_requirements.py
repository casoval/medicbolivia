"""
app/core/professional_requirements.py
Fuente única de verdad de los documentos que un profesional de salud debe
subir/completar para quedar verificado en MedicBolivia.

Por qué existe este archivo: esta misma lista estaba escrita a mano en al
menos tres lugares distintos (el prompt del Agente de Ayuda, el prompt del
Agente de Bienvenida, y la FAQ semilla) y se fue desincronizando con lo que
en verdad pide el formulario del profesional — llegó a seguir mencionando el
certificado del SEDES y la matrícula del Colegio Médico de Bolivia (CMB)
mucho después de que la plataforma dejó de pedirlos, y los agentes de IA
respondían con esa información vieja sin que nadie se diera cuenta.

Ahora hay un solo lugar para actualizar cuando cambien los requisitos: este
archivo. build_docs_context_text() arma el texto que los agentes reciben
como contexto en cada respuesta (ver coordinator.py), así que ya no hace
falta editar prompts a mano para que el cambio se refleje.

Nota importante: el formulario real que ve el profesional vive en el
frontend (frontend/src/app/professional/profile/page.tsx, arreglo
DOCUMENTS/REQUIRED_DOCS) — un runtime separado que no puede importar este
archivo de Python. Si se agrega, quita o cambia un documento ahí, hay que
reflejar el mismo cambio acá a mano. Lo que este archivo sí elimina es la
duplicación *dentro del backend* entre los distintos agentes y la FAQ.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class DocRequirement:
    doc_type: str
    label: str
    requirement: str  # "Obligatorio" | "Obligatorio si..." | "Solo si..."
    hint: str


# Debe reflejar exactamente lo que pide frontend/src/app/professional/profile/page.tsx
PROFESSIONAL_DOC_REQUIREMENTS: list[DocRequirement] = [
    DocRequirement(
        "CI_FRONT", "Cédula de identidad — anverso",
        "Obligatorio", "Foto clara, todos los datos legibles",
    ),
    DocRequirement(
        "CI_BACK", "Cédula de identidad — reverso",
        "Obligatorio", "Sin reflejos ni bordes cortados",
    ),
    DocRequirement(
        "PROFESSIONAL_TITLE", "Título en Provisión Nacional",
        "Obligatorio", "Título universitario habilitante para ejercer",
    ),
    DocRequirement(
        "HEALTH_MINISTRY", "Matrícula Profesional emitida por el Ministerio de Salud",
        "Obligatorio", "Matrícula vigente del Ministerio de Salud de Bolivia",
    ),
    DocRequirement(
        "SPECIALTY_CERT", "Respaldo de Especialidad",
        "Obligatorio si tu especialidad no es Medicina General",
        "Certificado, diploma o título que respalde tu especialidad",
    ),
    DocRequirement(
        "SUBSPECIALTY_CERT", "Respaldo de Subespecialidad",
        "Solo si agregaste una subespecialidad a tu perfil",
        "Certificado, diploma o título que respalde tu subespecialidad",
    ),
    DocRequirement(
        "SELFIE_WITH_CI", "Selfie sosteniendo tu CI",
        "Obligatorio", "Tu cara y la CI deben ser legibles",
    ),
]

VERIFICATION_SLA_TEXT = "24 a 72 horas hábiles"

# Estos dos NO son documentos que se suban como archivo (se completan directo
# en el perfil del profesional), pero son igual de obligatorios y suelen
# confundirse con "documentos" cuando preguntan qué les falta.
OTHER_MANDATORY_ITEMS = [
    "Número de matrícula profesional: es un dato de texto, se llena en el perfil (no un "
    "archivo) y se verifica contra la Matrícula del Ministerio de Salud subida",
    "Firma (dibujada o foto): obligatoria para poder emitir recetas y órdenes de laboratorio "
    "firmadas, y también pasa por revisión de un admin antes de poder usarse — si preguntan por "
    "qué no pueden emitir una receta, este suele ser el motivo",
]


def _docs_lines() -> str:
    return "\n".join(
        f"- {d.label} ({d.requirement}): {d.hint}"
        for d in PROFESSIONAL_DOC_REQUIREMENTS
    )


def _other_items_lines() -> str:
    return "\n".join(f"- {item}" for item in OTHER_MANDATORY_ITEMS)


def build_docs_context_text() -> str:
    """Arma un bloque de texto plano (sin markdown, para que no aparezcan
    asteriscos literales en el chat) con los requisitos vigentes, pensado
    para inyectarse como contexto verificado en los agentes de IA.
    """
    return (
        "DOCUMENTOS REQUERIDOS PARA VERIFICACIÓN (fuente oficial y actualizada — usá esta lista "
        "tal cual, en texto plano sin markdown, y no completes con otros documentos que no estén "
        "acá, como SEDES o matrícula del Colegio Médico, que ya no se piden):\n"
        f"{_docs_lines()}\n"
        f"La revisión toma {VERIFICATION_SLA_TEXT} desde que se sube el último documento. Se "
        "avisa por SMS cuando el perfil queda aprobado.\n"
        "Además de estos documentos, también son obligatorios (no se suben como archivo, se "
        "completan en el perfil):\n"
        f"{_other_items_lines()}"
    )


def build_docs_public_text() -> str:
    """Misma información que build_docs_context_text(), pero como copia
    dirigida a una persona (sin las instrucciones para el agente de IA) —
    pensada para la FAQ pública de la landing, que también usa este mismo
    archivo como fuente para no duplicar la lista una tercera vez.
    """
    return (
        "Para verificarte necesitás subir, desde tu perfil:\n"
        f"{_docs_lines()}\n"
        f"La revisión toma {VERIFICATION_SLA_TEXT} desde que subís el último documento, y te "
        "avisamos por SMS cuando tu perfil sea aprobado.\n"
        "Además de estos documentos, también son obligatorios (se completan en tu perfil, no se "
        "suben como archivo):\n"
        f"{_other_items_lines()}"
    )
