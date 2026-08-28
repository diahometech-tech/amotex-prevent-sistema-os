import { randomUUID } from 'crypto';
import path from 'path';
import { saveUpload } from '@/lib/storage';

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extFromMime(mime: string): string {
  return MIME_EXT[mime] || 'bin';
}

// Salva uma foto (data URL base64) da OS. Cada foto ganha um nome único
// (UUID) — diferente de um upload de "slot único" (um documento por campo),
// uma OS tem várias fotos de antes/depois, então nunca sobrescreve a
// anterior. Retorna a URL pública ("/uploads/...") ou null se o formato do
// data URL for inválido.
export function saveOsFotoDataUrl(dataUrl: string, osId: string): string | null {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  const [, mime, b64] = matches;
  const buffer = Buffer.from(b64, 'base64');
  const ext = extFromMime(mime);
  const filename = `${randomUUID()}.${ext}`;
  return saveUpload(path.join('os', osId, filename), buffer);
}

// Salva uma assinatura digital (PNG do canvas). Sobrescreve a anterior —
// só existe uma assinatura de cada papel (zelador/técnico) por OS.
export function saveAssinaturaDataUrl(dataUrl: string, osId: string, papel: 'zelador' | 'tecnico'): string | null {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  const [, , b64] = matches;
  const buffer = Buffer.from(b64, 'base64');
  return saveUpload(path.join('os', osId, `assinatura-${papel}.png`), buffer);
}

// Salva o PDF gerado da OS (buffer vindo do servidor, não upload do cliente —
// ver src/lib/os-pdf.ts). Sobrescreve a cada finalização, é sempre a versão
// mais recente do documento.
export function saveOsPdfBuffer(buffer: Buffer, osId: string): string {
  return saveUpload(path.join('os', osId, 'os.pdf'), buffer);
}
