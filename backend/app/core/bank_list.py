"""
app/core/bank_list.py
Lista cerrada de bancos bolivianos para el selector de cuenta bancaria del
profesional (ver ProfessionalBankAccount en app/models/models.py). Son las
entidades con licencia bancaria plena (Bancos Múltiples) más los Bancos
PYME, ambos regulados por ASFI.

Revisar contra https://www.asfi.gob.bo/pb/bancos-multiples antes de cada
release grande — ASFI puede autorizar entidades nuevas o intervenir
alguna existente.

Banco Fassil queda deliberadamente AFUERA de esta lista: está intervenido
por ASFI desde 2023 y sin operación normal. No conviene aceptarlo como
cuenta de destino para pagos — si un profesional lo menciona, hay que
pedirle otra cuenta.

No se listan las cooperativas de ahorro y crédito (Jesús Nazareno, San
Martín, Fátima, etc.) — muy usadas fuera de las ciudades grandes — porque
son demasiadas para un selector cerrado. Para eso está OTHER_BANK_LABEL:
el frontend lo usa para mostrar un campo de texto libre.
"""

# Bancos Múltiples con licencia bancaria plena.
BANCOS_MULTIPLES = [
    "Banco Nacional de Bolivia (BNB)",
    "Banco Mercantil Santa Cruz (BMSC)",
    "Banco de Crédito de Bolivia (BCP)",
    "Banco BISA",
    "Banco Unión",
    "Banco Económico",
    "Banco Ganadero",
    "Banco Solidario (BancoSol)",
    "Banco FIE",
    "Banco Fortaleza",
    "Banco Prodem",
]

# Bancos PYME (licencia más acotada, orientada a micro y pequeña empresa).
BANCOS_PYME = [
    "Banco PYME Ecofuturo",
    "Banco PYME de la Comunidad",
]

BOLIVIAN_BANKS: list[str] = BANCOS_MULTIPLES + BANCOS_PYME

# Valor que el frontend manda cuando el profesional elige "Otro" en el
# selector y escribe el nombre de su banco/cooperativa a mano — ese texto
# libre se guarda tal cual en ProfessionalBankAccount.bank_name.
OTHER_BANK_LABEL = "Otro"
