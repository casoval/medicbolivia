"""
app/api/v1/endpoints/notifications_ws.py
WebSocket de notificaciones push en tiempo real: reemplaza al polling de
4 segundos que NotificationToast.tsx hacía contra /consultations/my desde
CUALQUIER pantalla de la app, todo el tiempo, para cualquier usuario
logueado (paciente o profesional).

Cada evento (nueva consulta, cambio de estado, mensaje de chat nuevo,
etc.) se empuja desde app/services/notify.py (notify_user() y
push_notification_ws()) hacia el canal Redis del usuario destinatario —
ver app/core/notification_ws_manager.py para el mecanismo (mismo patrón
multi-worker que ya usa el chat en producción).

Es solo de lectura desde el cliente: no recibe mensajes del navegador,
solo empuja hacia él. El polling de /consultations/my NO se elimina —
queda como respaldo a intervalo largo en NotificationToast.tsx por si el
socket se corta (apps en segundo plano, reconexión en curso, etc.).
"""
from fastapi import APIRouter, WebSocket, Query
from sqlalchemy import select
from jose import JWTError
from loguru import logger

from app.db.database import AsyncSessionLocal
from app.core.security import decode_token, AUTH_COOKIE_NAME
from app.core.notification_ws_manager import notification_manager
from app.models.models import User

router = APIRouter()


async def _authenticate_ws(token: str | None) -> str | None:
    """Devuelve el user_id si el token es válido, o None. Mismo patrón
    que chat.py::_authenticate_ws, pero acá alcanza con el user_id del
    propio JWT — no hace falta cargar el User completo para nada más
    que confirmar que existe."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id).where(User.id == user_id))
        return result.scalar_one_or_none()


@router.websocket("/ws/notifications")
async def notifications_websocket(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    auth_token = websocket.cookies.get(AUTH_COOKIE_NAME) or token
    user_id = await _authenticate_ws(auth_token)
    if not user_id:
        await websocket.close(code=4001, reason="Token inválido o expirado")
        return

    conn_id = await notification_manager.connect(user_id, websocket)
    try:
        while True:
            # No se espera nada del cliente — este socket es solo de
            # push. Igual hay que leer, si no la desconexión del
            # navegador nunca se detecta acá (WebSocketDisconnect se
            # dispara al leer, no al escribir).
            await websocket.receive_text()
    except Exception:
        pass  # desconexión normal (cierre de pestaña, red, etc.)
    finally:
        notification_manager.disconnect(user_id, conn_id)
