/** Convertit une data URL (photo capturée en base64) en File pour l'upload via FormData. */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

/** Convertit un Blob (ex. vidéo enregistrée) en File pour l'upload via FormData. */
export function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'video/webm' });
}
