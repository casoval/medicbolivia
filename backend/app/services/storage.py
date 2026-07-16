"""
app/services/storage.py
Servicio de almacenamiento en Cloudflare R2 para documentos médicos y fotos de perfil.
R2 es compatible con la API de S3 — solo cambia el endpoint y se eliminan
los parámetros no soportados (ACL, ServerSideEncryption).
"""
import uuid
import boto3
from botocore.exceptions import ClientError
from loguru import logger
from app.core.config import settings


def _get_r2_client():
    """Cliente S3 apuntando al endpoint de Cloudflare R2."""
    endpoint = f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",   # R2 siempre usa "auto", no una región de AWS
    )


async def upload_document_to_r2(
    file_content: bytes,
    file_name: str,
    professional_id: str,
    doc_type: str,
    content_type: str,
) -> str:
    """
    Sube un documento de verificación al bucket PRIVADO de R2.
    Los documentos nunca son accesibles directamente — se sirven
    con URLs firmadas de duración limitada (ver get_presigned_url).
    Retorna una URL interna con formato r2://bucket/key.
    """
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    key = f"professionals/{professional_id}/{doc_type}/{uuid.uuid4()}.{ext}"

    try:
        r2 = _get_r2_client()
        r2.put_object(
            Bucket=settings.R2_BUCKET_DOCS,
            Key=key,
            Body=file_content,
            ContentType=content_type,
            # R2 cifra todo en reposo automáticamente — no hace falta pedirlo.
            # R2 no soporta ACL — el acceso se controla a nivel de bucket.
        )
        url = f"r2://{settings.R2_BUCKET_DOCS}/{key}"
        logger.info(f"Documento subido a R2: {key}")
        return url

    except ClientError as e:
        logger.error(f"Error subiendo documento a R2: {e}")
        raise Exception("Error al subir el documento. Intenta de nuevo.")


async def upload_photo_to_r2(
    file_content: bytes,
    file_name: str,
    professional_id: str,
    content_type: str,
) -> str:
    """
    Sube la foto de perfil al bucket PÚBLICO de R2.
    Retorna la URL pública directa (sin firma) que se guarda en la BD
    y se muestra a los pacientes en el buscador.
    """
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "jpg"
    key = f"profiles/{professional_id}/{uuid.uuid4()}.{ext}"

    try:
        r2 = _get_r2_client()
        r2.put_object(
            Bucket=settings.R2_BUCKET_PHOTOS,
            Key=key,
            Body=file_content,
            ContentType=content_type,
        )
        # URL pública: base configurada en R2_PUBLIC_PHOTOS_URL + key
        public_url = f"{settings.R2_PUBLIC_PHOTOS_URL.rstrip('/')}/{key}"
        logger.info(f"Foto de perfil subida a R2: {key}")
        return public_url

    except ClientError as e:
        logger.error(f"Error subiendo foto a R2: {e}")
        raise Exception("Error al subir la foto de perfil. Intenta de nuevo.")


async def upload_chat_attachment_to_r2(
    file_content: bytes,
    file_name: str,
    conversation_id: str,
    content_type: str,
) -> str:
    """
    Sube un adjunto de chat (foto, PDF) al mismo bucket PRIVADO que los
    documentos de verificación (R2_BUCKET_DOCS), bajo el prefijo
    "chat/{conversation_id}/...". Nunca se guarda una URL pública — se
    firma bajo demanda con get_presigned_url, igual que los documentos.
    Retorna la key interna (formato r2://bucket/key), lista para guardar
    en ChatMessage.attachment_key.
    """
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    key = f"chat/{conversation_id}/{uuid.uuid4()}.{ext}"

    try:
        r2 = _get_r2_client()
        r2.put_object(
            Bucket=settings.R2_BUCKET_DOCS,
            Key=key,
            Body=file_content,
            ContentType=content_type,
        )
        url = f"r2://{settings.R2_BUCKET_DOCS}/{key}"
        logger.info(f"Adjunto de chat subido a R2: {key}")
        return url

    except ClientError as e:
        logger.error(f"Error subiendo adjunto de chat a R2: {e}")
        raise Exception("Error al subir el archivo. Intenta de nuevo.")


async def upload_backup_to_r2(
    file_content: bytes,
    file_name: str,
) -> str:
    """
    Sube un dump de backup de la base de datos al mismo bucket PRIVADO
    que los documentos de verificación (R2_BUCKET_DOCS), bajo el prefijo
    "backups/". Usado como fallback en app/tasks/backup_tasks.py cuando
    el dump supera BACKUP_MAX_ATTACHMENT_MB y no puede ir como adjunto
    de Gmail. Nunca es público — se sirve con get_presigned_url, igual
    que documentos y adjuntos de chat.
    Retorna la key interna (formato r2://bucket/key).
    """
    key = f"backups/{file_name}"

    try:
        r2 = _get_r2_client()
        r2.put_object(
            Bucket=settings.R2_BUCKET_DOCS,
            Key=key,
            Body=file_content,
            ContentType="application/gzip",
        )
        url = f"r2://{settings.R2_BUCKET_DOCS}/{key}"
        logger.info(f"Backup de BD subido a R2: {key}")
        return url

    except ClientError as e:
        logger.error(f"Error subiendo backup a R2: {e}")
        raise Exception("Error al subir el backup a R2.")


async def get_presigned_url(r2_url: str, expires_seconds: int = 300) -> str:
    """
    Genera una URL temporal (5 min por defecto) para que el admin
    pueda ver un documento privado sin exponerlo permanentemente.
    Acepta URLs con formato r2://bucket/key o s3://bucket/key (legacy).
    """
    # Soporta el prefijo antiguo "s3://" por compatibilidad con registros previos
    raw = r2_url.replace("r2://", "").replace("s3://", "")
    bucket, key = raw.split("/", 1)

    try:
        r2 = _get_r2_client()
        url = r2.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_seconds,
        )
        return url
    except ClientError as e:
        logger.error(f"Error generando URL firmada: {e}")
        raise Exception("No se pudo generar el enlace de descarga.")