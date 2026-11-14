"""Prueba aislada (sin Django, sin levantar el backend):
    cd backend && python scripts_test_gemini_model.py [modelo]
Usa GEMINI_API_KEY / GEMINI_MODEL del .env vía app.core.config y la MISMA
config de razonamiento que _call_gemini."""
import sys
from google import genai
from google.genai import types
from app.core.config import settings
from app.agents.coordinator import _thinking_config_for

model = sys.argv[1] if len(sys.argv) > 1 else settings.GEMINI_MODEL
client = genai.Client(api_key=settings.GEMINI_API_KEY)
print(f"Probando {model} con {_thinking_config_for(model)}")
try:
    r = client.models.generate_content(
        model=model,
        contents='Responde únicamente con la palabra "OK".',
        config=types.GenerateContentConfig(
            max_output_tokens=50, thinking_config=_thinking_config_for(model)),
    )
    print("✅ OK:", r.text)
except Exception as e:
    print("❌ ERROR:", e)
