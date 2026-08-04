"""
app/services/signature_image.py
Convierte una foto de una firma hecha en papel (fondo blanco/claro, tinta
oscura) en un PNG con fondo transparente, recortado al área del trazo —
listo para estampar en el PDF de receta (ver app/services/prescription_pdf.py).

No usa modelos de IA: es un umbral de luminancia con caída suave en el
borde (para que no quede pixelado) + autorrecorte a la zona con trazo.
Es, en esencia, lo mismo que se hizo A MANO para
app/assets/director_signature.png (ver el comentario en
app/services/invitation_pdf.py: "el trazo codificado como un canal alfa
invertido... quedó procesado invirtiendo el alfa") — acá se automatiza
para que cada médico lo resuelva solo desde su perfil, sin que alguien
del equipo tenga que editarle la imagen a mano.

Es un umbral simple, no un recorte de sujeto con IA: funciona bien con
tinta oscura sobre papel blanco/claro y luz pareja (el caso típico de
"firmá en una hoja y fotografiá con el celular"). Con fondos muy
sombreados, papel de color, o tinta muy clara puede salir peor — para
esos casos el médico siempre tiene la opción de dibujar en el lienzo.
"""
import io

from PIL import Image, ImageFilter

# Elegidos probando con fotos de celular en luz de oficina normal — no es
# una ciencia exacta. Si en producción sale mal con fotos reales de
# médicos, este es el primer lugar a ajustar.
DEFAULT_THRESHOLD = 195     # luminancia (0-255): por debajo se considera "tinta"
DEFAULT_SOFTNESS = 45       # rango de transición para evitar bordes pixelados (antialiasing)
INK_COLOR = (15, 34, 64)    # azul-tinta oscuro fijo, en vez del color real del píxel
                             # (que varía con sombras/reflejo del papel y queda inconsistente)
MAX_INPUT_DIMENSION = 1600  # una foto de celular no necesita más que esto para un sello de ~4cm en el PDF
MIN_INK_PIXELS = 200        # menos que esto y asumimos que no hay una firma real en la foto
CROP_PADDING = 12


class SignatureNotDetectedError(Exception):
    """La foto no tiene suficiente contraste/trazo oscuro como para asumir que hay una firma."""


def _resize_if_huge(img: Image.Image) -> Image.Image:
    if max(img.size) <= MAX_INPUT_DIMENSION:
        return img
    ratio = MAX_INPUT_DIMENSION / max(img.size)
    new_size = (max(int(img.size[0] * ratio), 1), max(int(img.size[1] * ratio), 1))
    return img.resize(new_size, Image.LANCZOS)


def _alpha_lookup_table(threshold: int, softness: int) -> list:
    """Tabla de 256 valores luminancia→alpha. Por debajo de
    threshold-softness es tinta opaca; por encima de threshold es fondo
    transparente; en el medio hay una rampa lineal (antialiasing) en vez
    de un corte duro pixelado."""
    table = []
    low = max(threshold - softness, 0)
    span = max(threshold - low, 1)
    for luminance in range(256):
        if luminance <= low:
            table.append(255)
        elif luminance >= threshold:
            table.append(0)
        else:
            table.append(int(255 * (threshold - luminance) / span))
    return table


def process_signature_photo(
    file_content: bytes,
    threshold: int = DEFAULT_THRESHOLD,
    softness: int = DEFAULT_SOFTNESS,
) -> bytes:
    """
    Recibe los bytes de una foto (JPG/PNG/WebP) de una firma en papel y
    devuelve los bytes de un PNG con fondo transparente, recortado al área
    de la firma. CPU-bound — llamar envuelto en asyncio.to_thread desde un
    endpoint (ver app/api/v1/endpoints/professionals.py).
    Lanza SignatureNotDetectedError si no hay suficiente contraste como
    para asumir que hay un trazo real (foto borrosa, mal iluminada, papel
    en blanco, etc.) — el caller debe traducir eso a un 400 con un mensaje
    que sugiera reintentar o usar el lienzo.
    """
    try:
        img = Image.open(io.BytesIO(file_content)).convert("RGB")
    except Exception as e:
        raise SignatureNotDetectedError(f"Imagen inválida o corrupta: {e}")

    img = _resize_if_huge(img)

    gray = img.convert("L")
    # Suaviza ruido/grano de cámara antes de umbralar, para que el borde
    # de la tinta no quede con puntitos sueltos alrededor.
    gray = gray.filter(ImageFilter.MedianFilter(size=3))

    alpha = gray.point(_alpha_lookup_table(threshold, softness))

    # Cuántos píxeles quedaron con algo de opacidad — vía histograma (C,
    # rápido) en vez de iterar getdata() en Python puro sobre una imagen
    # que puede tener más de un millón de píxeles.
    hist = alpha.histogram()
    ink_pixel_count = sum(hist[41:])
    if ink_pixel_count < MIN_INK_PIXELS:
        raise SignatureNotDetectedError("No se detectó suficiente trazo oscuro en la foto")

    ink_layer = Image.new("RGB", img.size, INK_COLOR)
    result = Image.new("RGBA", img.size)
    result.paste(ink_layer, (0, 0))
    result.putalpha(alpha)

    bbox = alpha.getbbox()
    if bbox:
        left, top, right, bottom = bbox
        left = max(left - CROP_PADDING, 0)
        top = max(top - CROP_PADDING, 0)
        right = min(right + CROP_PADDING, result.width)
        bottom = min(bottom + CROP_PADDING, result.height)
        result = result.crop((left, top, right, bottom))

    out = io.BytesIO()
    result.save(out, format="PNG")
    return out.getvalue()
