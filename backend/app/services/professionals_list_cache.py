"""
app/services/professionals_list_cache.py
Caché corta en Redis de GET /admin/professionals (sin filtro), compartida
entre todos los endpoints que puedan cambiar lo que esa lista muestra.

Vivía antes como función privada dentro de admin.py, pero los endpoints
de especialidad/subespecialidad (specialties.py: confirm_catalog_pick y
review_proposal) también cambian datos que esa lista refleja
(specialty, specialty_status, sub_specialty, sub_specialty_status,
professional.status) y no la estaban invalidando — el admin aprobaba o
rechazaba una especialidad, el cambio quedaba bien guardado en la base,
pero el próximo GET de la lista seguía sirviendo la respuesta cacheada
de hasta _PROFESSIONALS_LIST_CACHE_TTL segundos atrás, dando la
impresión de que "no se actualiza en vivo" hasta que el caché expiraba
solo. Centralizarla acá evita que un tercer endpoint futuro repita el
mismo olvido.
"""
from loguru import logger

from app.core.redis_client import redis_client

PROFESSIONALS_LIST_CACHE_KEY = "cache:admin:professionals_list"
PROFESSIONALS_LIST_CACHE_TTL = 20  # segundos


async def invalidate_professionals_list_cache() -> None:
    try:
        await redis_client.delete(PROFESSIONALS_LIST_CACHE_KEY)
    except Exception as e:
        # Si Redis está caído, no vale la pena tumbar la request completa
        # por esto — en el peor caso el admin ve datos con hasta
        # PROFESSIONALS_LIST_CACHE_TTL segundos de atraso.
        logger.warning(f"No se pudo invalidar cache de admin/professionals: {e}")