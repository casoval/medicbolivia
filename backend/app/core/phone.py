"""
app/core/phone.py
Normalización ÚNICA de números de teléfono para todo el proyecto.

Por qué existe: antes de este archivo había 4 copias casi idénticas de
esta misma lógica (schemas.py x3 validadores + services/whatsapp.py::
_to_e164), y ninguna forzaba un formato final consistente — solo
validaban que fueran dígitos. Eso permitía que un mismo número quedara
guardado como "72345678", "59172345678" o "+59172345678" según cómo lo
haya tipeado la persona, y como WhatsApp (Baileys y la Cloud API) siempre
identifica contactos con código de país, cualquier comparación exacta
(`User.phone == payload.phone`) fallaba en silencio para los números
guardados sin el "591" adelante.

FORMATO CANÓNICO elegido para TODO el proyecto: dígitos, con código de
país, SIN "+" (ej. "59172345678"). Es el mismo formato que ya esperaba
la Cloud API de Meta y el que arma Baileys en sus JID — así que se
normaliza una sola vez acá y ya no hace falta tocar nada del lado de
whatsapp-service.
"""
import re


class InvalidPhoneError(ValueError):
    pass


def normalize_bo_phone(raw: str) -> str:
    """
    Normaliza un número boliviano al formato canónico "591XXXXXXXX".

    Acepta como entrada cualquiera de estos formatos:
      "72345678"        (8 dígitos, formato local sin código de país)
      "59172345678"     (con código de país)
      "+591 7234-5678"  (con '+', espacios o guiones)

    Lanza InvalidPhoneError si no matchea ninguno de los formatos válidos
    — evita silenciosamente aceptar números mal tipeados que después no
    va a poder alcanzar ni el bot ni los recordatorios.
    """
    digits = re.sub(r"\D", "", raw or "")

    if len(digits) == 8:
        digits = f"591{digits}"
    elif len(digits) == 11 and digits.startswith("591"):
        pass  # ya viene con código de país
    else:
        raise InvalidPhoneError(
            f"Número de teléfono inválido: '{raw}'. Se espera un número "
            "boliviano de 8 dígitos (ej: 72345678), con o sin el código "
            "de país 591."
        )

    return digits


def display_phone(canonical: str) -> str:
    """'59172345678' -> '+591 7234 5678', solo para mostrar en UI."""
    if len(canonical) != 11:
        return canonical
    return f"+{canonical[:3]} {canonical[3:7]} {canonical[7:]}"


# ── Soporte multi-país (registro) ─────────────────────
# Lista curada y corta a propósito — no pretende cubrir los ~200 códigos
# de marcado del mundo, solo los países con los que MedicBolivia tiene
# probabilidad real de recibir registros por ahora. Se puede ampliar
# después sin tocar nada más (el front la consume tal cual).
# Bolivia queda primero porque el frontend la usa como default preseleccionado.
COUNTRY_CALLING_CODES: list[dict[str, str]] = [
    {"code": "591", "name": "Bolivia", "flag": "🇧🇴"},
    {"code": "54", "name": "Argentina", "flag": "🇦🇷"},
    {"code": "55", "name": "Brasil", "flag": "🇧🇷"},
    {"code": "56", "name": "Chile", "flag": "🇨🇱"},
    {"code": "51", "name": "Perú", "flag": "🇵🇪"},
    {"code": "595", "name": "Paraguay", "flag": "🇵🇾"},
    {"code": "57", "name": "Colombia", "flag": "🇨🇴"},
    {"code": "34", "name": "España", "flag": "🇪🇸"},
    {"code": "1", "name": "Estados Unidos", "flag": "🇺🇸"},
    {"code": "52", "name": "México", "flag": "🇲🇽"},
]


def normalize_intl_phone(raw: str, default_country_code: str = "591") -> str:
    """
    Normaliza un teléfono internacional al formato canónico
    "<código_país><número>" (dígitos, sin '+').

    A diferencia de normalize_bo_phone (que fuerza Bolivia siempre), esta
    función se usa donde el FRONTEND ya adjuntó el código de país elegido
    por la persona en el selector de registro — la entrada esperada llega
    con el código de país ya pegado adelante (ej. "59172345678",
    "5491122334455").

    Por retrocompatibilidad con clientes viejos que todavía no mandan
    código de país (ej. integraciones que solo mandaban los 8 dígitos
    bolivianos sueltos), si la entrada tiene entre 6 y 8 dígitos se asume
    Bolivia y se le antepone default_country_code.

    No valida la longitud exacta por país (varía mucho: EEUU 10, España 9,
    Bolivia 8, Brasil 10-11, etc.) — solo un rango E.164 razonable
    (9 a 15 dígitos totales). Validar longitud exacta por país quedaría
    para una futura mejora si hace falta más precisión.
    """
    digits = re.sub(r"\D", "", raw or "")

    if 6 <= len(digits) <= 8:
        return f"{default_country_code}{digits}"
    if 9 <= len(digits) <= 15:
        return digits

    raise InvalidPhoneError(
        f"Número de teléfono inválido: '{raw}'. Debe incluir el código de "
        "país y el número, entre 9 y 15 dígitos en total."
    )
