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
