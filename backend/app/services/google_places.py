"""
app/services/google_places.py
Integración con Places API (New) de Google, usada por el buscador de
médicos del panel admin (ver app/api/v1/endpoints/admin.py ->
/admin/doctor-leads/search-maps y /admin/doctor-leads/place-details).

Dos llamadas separadas a propósito, igual que recomienda Google:
  - text_search(): barata, devuelve una lista de resultados (nombre,
    dirección, rating, place_id) SIN teléfono.
  - place_details(): se pide solo para un resultado puntual, cuando el
    admin decide "ver teléfono" / "importar como lead" — así no se paga
    el detalle de resultados que el admin ni siquiera va a mirar.

Requiere GOOGLE_PLACES_API_KEY en el .env (ver app/core/config.py). Si
no está configurada, ambas funciones levantan GooglePlacesNotConfigured
para que el endpoint devuelva un 503 claro en vez de un error genérico.
"""
import httpx
from typing import Optional
from loguru import logger

from app.core.config import settings

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"


class GooglePlacesNotConfigured(Exception):
    pass


class GooglePlacesError(Exception):
    pass


def _require_key() -> str:
    if not settings.GOOGLE_PLACES_API_KEY:
        raise GooglePlacesNotConfigured(
            "GOOGLE_PLACES_API_KEY no está configurada en el .env del backend"
        )
    return settings.GOOGLE_PLACES_API_KEY


async def text_search(query: str, city: str, max_results: int = 15) -> list[dict]:
    """
    Busca lugares en Google Maps a partir de una consulta libre + ciudad,
    ej. query="cardiólogo", city="Santa Cruz de la Sierra".

    Devuelve una lista de dicts livianos (sin teléfono, ver docstring del
    módulo) listos para mostrar como resultados previos en el admin:
    [{place_id, name, address, rating, user_rating_count, maps_url}, ...]
    """
    api_key = _require_key()
    text = f"{query} en {city}, Bolivia".strip()

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        # Field mask: pedimos solo lo mínimo para la vista previa —
        # cada campo de más que se pide en Text Search suma al costo.
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.rating,places.userRatingCount,places.googleMapsUri"
        ),
    }
    body = {"textQuery": text, "languageCode": "es", "maxResultCount": min(max_results, 20)}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(TEXT_SEARCH_URL, json=body, headers=headers)
    except httpx.RequestError as exc:
        logger.error(f"Error de red en Google Places text_search: {exc}")
        raise GooglePlacesError("No se pudo conectar con Google Maps") from exc

    if resp.status_code >= 400:
        logger.error(f"Google Places text_search {resp.status_code}: {resp.text[:300]}")
        raise GooglePlacesError(f"Google Maps devolvió un error ({resp.status_code})")

    data = resp.json()
    results = []
    for place in data.get("places", []):
        results.append({
            "place_id": place.get("id"),
            "name": (place.get("displayName") or {}).get("text", ""),
            "address": place.get("formattedAddress"),
            "rating": place.get("rating"),
            "user_rating_count": place.get("userRatingCount"),
            "maps_url": place.get("googleMapsUri"),
        })
    return results


async def place_details(place_id: str) -> dict:
    """
    Trae el detalle de UN lugar puntual (incluye teléfono). Se llama solo
    cuando el admin ya eligió un resultado específico del text_search.
    """
    api_key = _require_key()

    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "id,displayName,formattedAddress,nationalPhoneNumber,"
            "internationalPhoneNumber,websiteUri,googleMapsUri"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(PLACE_DETAILS_URL.format(place_id=place_id), headers=headers)
    except httpx.RequestError as exc:
        logger.error(f"Error de red en Google Places place_details: {exc}")
        raise GooglePlacesError("No se pudo conectar con Google Maps") from exc

    if resp.status_code >= 400:
        logger.error(f"Google Places place_details {resp.status_code}: {resp.text[:300]}")
        raise GooglePlacesError(f"Google Maps devolvió un error ({resp.status_code})")

    place = resp.json()
    return {
        "place_id": place.get("id"),
        "name": (place.get("displayName") or {}).get("text", ""),
        "address": place.get("formattedAddress"),
        "phone": place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber"),
        "website": place.get("websiteUri"),
        "maps_url": place.get("googleMapsUri"),
    }
