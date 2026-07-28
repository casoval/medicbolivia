"""
app/core/notification_ws_manager.py
Gestor de conexiones WebSocket de notificaciones push (cambios de estado
de una consulta: aceptada, cancelada, iniciada, completada, etc).

Mismo patrón que app/core/chat_ws_manager.py (ya probado en producción),
adaptado para notificaciones: en vez de un canal Redis por conversación,
acá es un canal Redis por USUARIO (user.id) — cualquier evento relevante
para ese usuario (sea paciente o profesional) se publica en su canal, y
todos los workers con un socket local abierto de ese usuario lo reciben
y reenvían.

Este WebSocket reemplaza al polling de 4 segundos que antes hacía
NotificationToast.tsx contra /consultations/my en TODA la app, todo el
tiempo, para cualquier usuario logueado — con miles de usuarios activos
simultáneos eso significaba (usuarios conectados) × (1 request cada 4s)
sostenido para siempre, solo para detectar cambios de estado. Con push,
el backend avisa una sola vez, exactamente cuando algo cambió de verdad.

El polling NO se elimina del todo — queda como respaldo a intervalo largo
(ver NotificationToast.tsx) por si el socket se corta (apps en segundo
plano, wifi inestable, reconexión en curso), para no depender al 100% de
que la conexión en tiempo real esté siempre viva.
"""
import json
import asyncio
from typing import Dict
from fastapi import WebSocket
from loguru import logger

from app.core.redis_client import redis_client

CHANNEL_PREFIX = "notif:user:"


class NotificationConnectionManager:
    def __init__(self):
        # user_id -> { connection_id -> WebSocket }. Un mismo usuario puede
        # tener más de una pestaña/dispositivo abierto a la vez, por eso es
        # un dict de sockets y no un socket único (a diferencia del chat,
        # que es 1 socket por usuario por conversación).
        self.local: Dict[str, Dict[int, WebSocket]] = {}
        self._listeners: Dict[str, asyncio.Task] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> int:
        await ws.accept()
        conn_id = id(ws)
        self.local.setdefault(user_id, {})[conn_id] = ws

        if user_id not in self._listeners:
            self._listeners[user_id] = asyncio.create_task(self._listen(user_id))
        return conn_id

    def disconnect(self, user_id: str, conn_id: int):
        user_sockets = self.local.get(user_id)
        if not user_sockets:
            return
        user_sockets.pop(conn_id, None)

        if not user_sockets:
            self.local.pop(user_id, None)
            task = self._listeners.pop(user_id, None)
            if task:
                task.cancel()

    async def publish(self, user_id: str, payload: dict) -> None:
        """Publica el evento en Redis — todos los workers con sockets
        abiertos de este usuario lo recibirán vía _listen(). Nunca lanza
        excepción hacia arriba: un fallo acá (Redis caído, lo que sea) no
        debe romper la operación real (aceptar/cancelar/etc) que disparó
        la notificación — en el peor caso, el usuario se entera del
        cambio por el polling de respaldo en vez de al instante."""
        try:
            await redis_client.publish(f"{CHANNEL_PREFIX}{user_id}", json.dumps(payload))
        except Exception as e:
            logger.warning(f"notification_ws_manager: no se pudo publicar para user_id={user_id}: {e}")

    async def _listen(self, user_id: str):
        """Igual que ChatConnectionManager._listen(): reintenta ante
        cualquier error para no dejar al usuario sin listener hasta que
        se reconecte manualmente."""
        channel = f"{CHANNEL_PREFIX}{user_id}"
        try:
            while True:
                pubsub = redis_client.pubsub()
                try:
                    await pubsub.subscribe(channel)
                    async for message in pubsub.listen():
                        if message["type"] != "message":
                            continue
                        payload = json.loads(message["data"])
                        user_sockets = self.local.get(user_id, {})
                        for ws in list(user_sockets.values()):
                            try:
                                await ws.send_json(payload)
                            except Exception:
                                pass  # el disconnect lo limpia el endpoint
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception(
                        f"notification_ws_manager: listener de Redis cortado para "
                        f"user_id={user_id}, reintentando en 2s"
                    )
                    await asyncio.sleep(2)
                    continue
                finally:
                    try:
                        await pubsub.unsubscribe(channel)
                        await pubsub.aclose()
                    except Exception:
                        pass
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass
        finally:
            self._listeners.pop(user_id, None)


notification_manager = NotificationConnectionManager()
