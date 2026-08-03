"""
app/core/lab_test_catalog.py
Catálogo de estudios de laboratorio/imagenología más solicitados, para el
selector rápido del médico al emitir una orden de laboratorio (ver
LabOrder en app/models/models.py). No es una lista cerrada como
app.core.bank_list: el frontend siempre debe ofrecer también "Agregar
estudio manual" (texto libre) para lo que no esté acá — la variedad real
de estudios que un médico puede pedir es enorme y esta lista solo cubre
los más comunes para agilizar el formulario, no reemplaza el criterio
médico.

Agrupado por categoría solo para la UI (un <optgroup> o secciones
colapsables) — en el backend se guarda como texto plano, sin categoría.
"""

LAB_TEST_CATALOG: dict[str, list[str]] = {
    "Hematología": [
        "Hemograma completo",
        "Velocidad de eritrosedimentación (VES)",
        "Tiempo de protrombina (TP)",
        "Tiempo de tromboplastina parcial (TTP)",
        "Grupo sanguíneo y factor Rh",
    ],
    "Bioquímica": [
        "Glucosa en ayunas",
        "Hemoglobina glicosilada (HbA1c)",
        "Perfil lipídico completo",
        "Colesterol total",
        "Triglicéridos",
        "Perfil hepático (transaminasas, bilirrubinas)",
        "Perfil renal (creatinina, urea, ácido úrico)",
        "Electrolitos (sodio, potasio, cloro)",
        "Proteína C reactiva (PCR)",
        "Amilasa",
    ],
    "Hormonas": [
        "TSH",
        "T3 y T4 libre",
        "Perfil tiroideo completo",
        "Insulina basal",
        "Cortisol",
        "Prolactina",
        "Beta-hCG (embarazo)",
    ],
    "Orina y heces": [
        "Examen general de orina",
        "Urocultivo",
        "Coproparasitológico",
        "Sangre oculta en heces",
    ],
    "Infecciosas / serología": [
        "VIH",
        "VDRL / sífilis",
        "Hepatitis B (HBsAg)",
        "Hepatitis C",
        "PCR para COVID-19",
    ],
    "Imagenología": [
        "Radiografía de tórax",
        "Ecografía abdominal",
        "Ecografía obstétrica",
        "Electrocardiograma (ECG)",
        "Tomografía computarizada",
        "Resonancia magnética",
    ],
}


def flat_catalog() -> list[str]:
    """Lista plana de todos los estudios, sin categoría — por si algún
    consumidor solo necesita validar/buscar nombres, no mostrarlos agrupados."""
    return [test for tests in LAB_TEST_CATALOG.values() for test in tests]
