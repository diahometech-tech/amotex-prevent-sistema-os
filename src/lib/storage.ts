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

// Apaga uma pasta inteira de uploads (ex.: "os/<id>", "equipamentos/<id>")
// quando o registro dono dela é apagado. Mesma proteção contra traversal de
// resolveUploadFile; nunca apaga a raiz. Falha silenciosa: o registro já saiu
// do banco, um arquivo órfão no disco não pode virar erro pro usuário.
export function removeUploadDir(relDir: string): void {
  for (const base of [UPLOADS_DIR, LEGACY_UPLOADS_DIR]) {
    const root = path.resolve(base);
    const full = path.resolve(base, relDir);
    if (!full.startsWith(root + path.sep)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {
      console.error('Falha ao apagar pasta de uploads:', relDir, e);
    }
  }
}

// Apaga um arquivo a partir da URL "/uploads/...". Falha silenciosa (ver acima).
export function removeUploadFile(url: string | undefined | null): void {
  const full = resolveUploadFile(url);
  if (!full) return;
  try {
    fs.unlinkSync(full);
  } catch (e) {
    console.error('Falha ao apagar arquivo de upload:', url, e);
  }
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

