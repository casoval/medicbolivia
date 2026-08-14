"""
app/core/support_chat_ws_manager.py
Gestor de conexiones WebSocket del chat directo con soporte (paciente o
profesional <-> admin). Reusa exactamente la misma lógica de
ChatConnectionManager (multi-worker vía Redis Pub/Sub, ver
core/chat_ws_manager.py) pero con su propio canal Redis, para mantener
este módulo completamente separado del chat interno paciente-profesional.
"""
from app.core.chat_ws_manager import ChatConnectionManager

support_chat_manager = ChatConnectionManager(channel_prefix="support_chat:conversation:")
