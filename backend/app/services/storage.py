"""
app/services/storage.py
Servicio de almacenamiento en AWS S3 para documentos médicos.
Los documentos se guardan cifrados y con rutas privadas.
"""
import boto3
from botocore.exceptions import ClientError
from loguru import logger
from app.core.config import settings


def _get_s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
    )


async def upload_document_to_s3(
    file_content: bytes,
    file_name: str,
    professional_id: str,
    doc_type: str,
    content_type: str
) -> str:
    """
    Sube un documento al S3 con ruta privada.
    Retorna la URL del archivo subido.
    """
    import uuid
    ext = file_name.split(".")[-1] if "." in file_name else "bin"
    key = f"professionals/{professional_id}/{doc_type}/{uuid.uuid4()}.{ext}"

    try:
        s3 = _get_s3_client()
        s3.put_object(
            Bucket=settings.AWS_BUCKET_NAME,
            Key=key,
            Body=file_content,
            ContentType=content_type,
            ServerSideEncryption="AES256",   # Cifrado en reposo
            ACL="private",                    # Nunca público
        )
        # Retornar URL interna (no pública)
        url = f"s3://{settings.AWS_BUCKET_NAME}/{key}"
        logger.info(f"Documento subido: {key}")
        return url

    except ClientError as e:
        logger.error(f"Error subiendo a S3: {e}")
        raise Exception("Error al subir el documento. Intenta de nuevo.")


async def get_presigned_url(s3_url: str, expires_seconds: int = 300) -> str:
    """
    Genera una URL temporal (5 min) para que el admin pueda ver el documento.
    El documento nunca es público de forma permanente.
    """
    # Extraer bucket y key de la URL s3://bucket/key
    parts = s3_url.replace("s3://", "").split("/", 1)
    bucket = parts[0]
    key = parts[1]

    try:
        s3 = _get_s3_client()
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_seconds
        )
        return url
    except ClientError as e:
        logger.error(f"Error generando URL firmada: {e}")
        raise Exception("No se pudo generar el enlace de descarga.")
