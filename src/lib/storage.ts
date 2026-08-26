import fs from 'fs';
import path from 'path';

// Diretório dos uploads.
// - Dev (padrão): public/uploads — servido estaticamente pelo Next.
// - Produção: setar UPLOADS_DIR (ex.: /var/nexusflow/uploads) — fora do build,
//   sobrevive a deploys; servido pela rota autenticada /uploads/[...path].
export const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(process.cwd(), 'public', 'uploads');

// Pasta legada (instalações que começaram antes do UPLOADS_DIR).
const LEGACY_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Salva um buffer em UPLOADS_DIR/<relPath> e retorna a URL "/uploads/...".
export function saveUpload(relPath: string, buffer: Buffer): string {
  const full = path.join(UPLOADS_DIR, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, buffer);
  return '/uploads/' + relPath.split(path.sep).join('/');
}

// Resolve uma URL "/uploads/..." para o caminho real no disco (com proteção
// contra path traversal). Procura em UPLOADS_DIR e na pasta legada.
export function resolveUploadFile(url: string | undefined | null): string | null {
  if (!url || !url.startsWith('/uploads/')) return null;
  const rel = url.slice('/uploads/'.length);
  for (const base of [UPLOADS_DIR, LEGACY_UPLOADS_DIR]) {
    const full = path.resolve(base, rel);
    if (!full.startsWith(path.resolve(base) + path.sep)) continue; // traversal
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Remove arquivos de um campo dentro da pasta da OS (troca de extensão).
export function removeFieldFiles(dossierId: string, field: string) {
  const osDir = path.join(UPLOADS_DIR, dossierId);
  if (!fs.existsSync(osDir)) return;
  for (const f of fs.readdirSync(osDir)) {
    if (f.startsWith(`${field}.`)) {
      try { fs.unlinkSync(path.join(osDir, f)); } catch {}
    }
  }
}

// Campos de arquivo do dossiê → nome amigável (usado no ZIP e na exportação).
export const FILE_FIELDS: { field: string; label: string }[] = [
  { field: 'photo_doc_frente_url', label: 'Documento-Frente' },
  { field: 'photo_doc_verso_url', label: 'Documento-Verso' },
  { field: 'photo_doc_completo_url', label: 'Documento-Completo' },
  { field: 'photo_cnh_url', label: 'CNH' },
  { field: 'photo_selfie_url', label: 'Selfie' },
  { field: 'photo_selfie_rg_url', label: 'Selfie-com-RG' },
  { field: 'video_prova_url', label: 'Video-Prova-de-Vida' },
  { field: 'certificado_a1_url', label: 'Certificado-A1' },
  { field: 'documento_b_url', label: 'Documento-B' },
  { field: 'cnpj_comprovante_url', label: 'Cartao-CNPJ' },
  { field: 'inscricao_municipal_url', label: 'Inscricao-Municipal' },
  { field: 'inscricao_estadual_url', label: 'Inscricao-Estadual' },
  { field: 'opcao_simples_url', label: 'Opcao-Simples' },
  { field: 'certidao_inteiro_teor_url', label: 'Certidao-Inteiro-Teor' },
];
