import httpx
try:
    r = httpx.get("https://api.ipify.org", timeout=10.0)
    print("IP PÚBLICA DE SALIDA:", r.text)
except Exception as e:
    print("No se pudo obtener:", e)