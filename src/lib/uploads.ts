import fs from 'fs';
import path from 'path';
import { saveUpload, removeFieldFiles } from '@/lib/storage';

// Extrai extensão a partir do mime do data URL.
// BUG REAL corrigido (24/07/2026, reportado: "o .rar do certificado A1 tá
// baixando como .bin"): `'application/octet-stream': 'pfx'` estava no map
// genérico, checado ANTES do fallback específico do A1 (linha abaixo) — e
// .rar é EXATAMENTE o tipo de arquivo que navegadores mais mandam como
// `application/octet-stream` (extensão sem associação de mime nativa no
// SO/navegador). Resultado: um .rar de A1 virava `.pfx` (errado, mas pelo
// menos abria como arquivo) — e OS mais antigas, enviadas antes do fix
// anterior (que passou a repassar o parâmetro `field` pra esta função),
// tinham ficado com `.bin` de verdade, gravado permanentemente no disco
// (esta função só afeta uploads NOVOS — não corrige arquivo já salvo).
export function extFromMime(mime: string, field?: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/x-pkcs12': 'pfx',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/vnd.rar': 'rar',
    'application/x-rar-compressed': 'rar',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  if (map[mime]) return map[mime];
  // O Certificado A1 (e-CNPJ) é entregue como .zip/.rar (pfx + senha
  // compactados juntos — ver certificado_a1_url). Navegadores frequentemente
  // não reconhecem essa extensão e mandam mime vazio ou `octet-stream` —
  // sem esse fallback específico ANTES do genérico de octet-stream, o
  // arquivo virava `.pfx` (formato errado) ou `.bin` (ilegível). Checado
  // pro campo do A1 antes de qualquer fallback genérico de mime ambíguo.
  if (field === 'certificado_a1_url') return 'zip';
  // `application/octet-stream` é o mime genérico que o navegador manda
  // quando não reconhece a extensão — só cai aqui pros OUTROS campos (o
  // A1 já foi resolvido acima). Histórico: usado originalmente pro
  // upload de `.pfx` solto (regra antiga, antes do A1 virar zip/rar).
  if (mime === 'application/octet-stream') return 'pfx';
  return 'bin';
}

// Salva um data URL (base64) em pasta POR OS dentro do UPLOADS_DIR e retorna
// a URL pública. Se NEXUS_FILES_DIR estiver definido (pasta da rede interna),
// espelha o arquivo lá.
//
// Compartilhado entre /api/dossiers/[id]/upload e /api/consulta/dossiers/[id]/a1
// (upload do certificador de campo) — antes vivia só no primeiro; extraído
// pra não duplicar a lógica de extensão/espelhamento numa terceira cópia.
export function saveDataUrl(dataUrl: string, field: string, dossierId: string): string | null {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  const [, mime, b64] = matches;
  const buffer = Buffer.from(b64, 'base64');
  const ext = extFromMime(mime, field);
  const filename = `${field}.${ext}`;

  // 1) Cópia servível pelo navegador: UPLOADS_DIR/<osId>/<campo>.<ext>
  // Remove versões antigas do mesmo campo (extensão diferente).
  removeFieldFiles(dossierId, field);
  const url = saveUpload(path.join(dossierId, filename), buffer);

  // 2) Espelho na pasta da rede interna (produção), se configurada.
  const netDir = process.env.NEXUS_FILES_DIR;
  if (netDir) {
    try {
      const dest = path.join(netDir, dossierId);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, filename), buffer);
    } catch (e) {
      console.error('Falha ao espelhar na pasta de rede:', e);
    }
  }

  return url;
}
