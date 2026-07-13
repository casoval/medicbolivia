"""
app/core/chat_ws_manager.py
Gestor de conexiones WebSocket del chat interno.

El backend corre con --workers 2 (ver ecosystem.config.js), así que un
diccionario en memoria NO alcanza: si el paciente cae en el worker 1 y
el profesional en el worker 2, el worker 1 nunca podría "ver" el socket
del profesional para reenviarle el mensaje directamente en Python.

Por eso cada worker:
  1. Mantiene sus propios sockets conectados en memoria (self.local).
  2. Se suscribe a un canal Redis Pub/Sub por conversación al abrir el
     primer socket de esa conversación.
  3. Al mandar un mensaje, en vez de buscar el socket del destinatario en
     memoria, publica en el canal Redis — y CADA worker (incluido el que
     originó el mensaje) lo recibe y lo reenvía a los sockets locales que
     tenga abiertos para esa conversación.

Esto es el mismo patrón que usarías con Socket.IO + un "adapter" de
Redis, pero implementado directo con redis.asyncio para no sumar una
dependencia nueva — ya está en requirements.txt.
"""
import json
import asyncio
from typing import Dict, Set
from fastapi import WebSocket
from loguru import logger

from app.core.redis_client import redis_client

CHANNEL_PREFIX = "chat:conversation:"


class ChatConnectionManager:
    def __init__(self):
        # conversation_id -> { user_id -> WebSocket }, solo los sockets
        # que están físicamente conectados a ESTE proceso worker.
        self.local: Dict[str, Dict[str, WebSocket]] = {}
        # conversation_id -> task de escucha del canal Redis de esa conversación
        self._listeners: Dict[str, asyncio.Task] = {}

    async def connect(self, conversation_id: str, user_id: str, ws: WebSocket):
        await ws.accept()
        self.local.setdefault(conversation_id, {})[user_id] = ws

        # Si es el primer socket local para esta conversación, arranca el
        # listener de Redis. Si ya había otro usuario de la misma
        # conversación conectado a este mismo worker, el listener ya existe.
        if conversation_id not in self._listeners:
            self._listeners[conversation_id] = asyncio.create_task(
                self._listen(conversation_id)
            )

    def disconnect(self, conversation_id: str, user_id: str):
        conv_sockets = self.local.get(conversation_id)
        if not conv_sockets:
            return
        conv_sockets.pop(user_id, None)

        if not conv_sockets:
            self.local.pop(conversation_id, None)
            task = self._listeners.pop(conversation_id, None)
            if task:
                task.cancel()

    async def broadcast(self, conversation_id: str, payload: dict):
        """Publica el evento en Redis — todos los workers con sockets
        abiertos de esta conversación lo recibirán vía _listen()."""
        await redis_client.publish(
            f"{CHANNEL_PREFIX}{conversation_id}", json.dumps(payload)
        )

    async def _listen(self, conversation_id: str):
        """Escucha el canal Redis de esta conversación indefinidamente,
        reintentando la suscripción ante cualquier error (no solo al
        cancelarse) — un pubsub.listen() que muere por un corte de Redis
        NO debe dejar la conversación sin listener hasta que todos los
        usuarios se desconecten. Antes, cualquier excepción que no fuera
        CancelledError mataba la tarea en silencio dejando la entrada en
        self._listeners como si siguiera viva, y este worker dejaba de
        reenviar mensajes de esa conversación hasta que todos los sockets
        locales se cerraran (lo único que limpiaba la entrada muerta)."""
        channel = f"{CHANNEL_PREFIX}{conversation_id}"
        try:
            while True:
                pubsub = redis_client.pubsub()
                try:
                    await pubsub.subscribe(channel)
                    async for message in pubsub.listen():
                        if message["type"] != "message":
                            continue
                        payload = json.loads(message["data"])
                        conv_sockets = self.local.get(conversation_id, {})
                        # Manda a TODOS los sockets locales de esta conversación,
                        # incluido el emisor (así confirma que se envió, sin
                        # necesidad de un ack aparte).
                        for ws in list(conv_sockets.values()):
                            try:
                                await ws.send_json(payload)
                            except Exception:
                                pass  # el disconnect lo limpia el endpoint
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception(
                        f"chat_ws_manager: listener de Redis cortado para "
                        f"conversation_id={conversation_id}, reintentando en 2s"
                    )
                    await asyncio.sleep(2)
                    continue
                finally:
                    try:
                        await pubsub.unsubscribe(channel)
                        await pubsub.aclose()
                    except Exception:
                        pass
                # Si pubsub.listen() termina solo (sin excepción), no debería
                # pasar en uso normal, pero por las dudas no lo dejamos morir
                # en silencio: reintenta en vez de salir del while.
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass
        finally:
            # Se borra a sí mismo de _listeners al terminar (por cancel() en
            # disconnect(), o si esta tarea muriera por algún motivo no
            # contemplado arriba) — así connect() siempre puede recrearlo.
            self._listeners.pop(conversation_id, None)


chat_manager = ChatConnectionManager()