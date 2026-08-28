// Serve os arquivos de upload em produção, quando UPLOADS_DIR aponta para uma
// pasta fora de public/ (ex.: /var/nexusflow/uploads). Exige sessão válida.
// Em dev (UPLOADS_DIR padrão = public/uploads) o Next serve o arquivo estático
// diretamente e esta rota nem é alcançada.
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { resolveUploadFile } from '@/lib/storage';
import { Database } from '@/lib/db';
import fs from 'fs';
import path from 'path';

type RouteContext = { params: Promise<{ path: string[] }> };

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.pfx': 'application/octet-stream',
  // Certificado A1 é sempre .zip/.rar (ver saveDataUrl/extFromMime) — sem
  // entrada aqui caía no fallback genérico application/octet-stream, que
  // funciona mas não é o mime correto do arquivo.
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }

  const { path: parts } = await context.params;

  // Toda foto/assinatura vive em uploads/os/<osId>/<arquivo> (ver
  // saveOsFotoDataUrl/saveAssinaturaDataUrl em src/lib/uploads.ts) — sessão
  // válida não basta, precisa ser de alguém com acesso ao condomínio daquela
  // OS. Sem isto, um síndico autenticado abre foto/assinatura de qualquer
  // condomínio só sabendo (ou adivinhando) o UUID da OS na URL.
  const [kind, osId] = parts;
  if (kind !== 'os' || !osId) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }
  const os = await Database.getOSById(osId);
  if (!os) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este arquivo.' }, { status: 403 });
  }

  const url = '/uploads/' + parts.join('/');
  const filePath = resolveUploadFile(url);
  if (!filePath) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Documento sensível/autenticado — sempre busca de novo, nunca reusa
      // uma resposta em cache (mesmo "private", que já impedia cache
      // compartilhado, mas ainda permitia o navegador reusar por 5min).
      // Consistente com o resto do app (ver nexusflow-context, item 6 dos
      // Incidentes) depois de um relato real de parceiro conseguindo
      // baixar o certificado só uma vez.
      'Cache-Control': 'no-store',
    },
  });
}
