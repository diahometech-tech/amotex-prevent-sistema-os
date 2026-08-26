import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp, isFieldRole } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';
import { FILE_FIELDS, resolveUploadFile } from '@/lib/storage';
import { gerarOsAberturaDocx } from '@/lib/os-abertura-doc';
import { dossierFolderName, buildResumoTxt } from '@/lib/dossie-export';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/dossiers/[id]/files-zip — baixa o dossiê completo em .zip:
// OS de Abertura (.docx) + todos os anexos + resumo.txt, pronto para colar
// na pasta da empresa no servidor interno.
export async function GET(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  // Mesmo bloqueio de papel das demais rotas de dossiê — captador só acessa a
  // tela de cadastro; terceiro usa a projeção própria (/api/terceiro/dossiers),
  // não baixa o dossiê completo (documentos pessoais do cliente).
  if (isFieldRole(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }

  const { id } = await context.params;
  try {
    const dossier = await Database.getDossierById(id);
    if (!dossier) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }

    // Checagem de atribuição (defesa em profundidade): gestor/admin têm acesso
    // irrestrito; operador_certificacao/operador_abertura só baixam o ZIP de
    // uma OS que é sua (ou ainda livre) — mesmo padrão de /reveal.
    if (session.role !== 'gestor' && session.role !== 'admin') {
      const responsavel =
        session.role === 'operador_certificacao' ? dossier.resp_certificacao
        : session.role === 'operador_abertura' ? dossier.resp_abertura
        : undefined;
      if (responsavel && responsavel !== session.name) {
        return NextResponse.json({ error: 'Esta OS está atribuída a outro responsável.' }, { status: 403 });
      }
    } else if (session.role === 'gestor') {
      // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts).
      const escopo = await getGestorScope(session);
      if (!dossierInGestorScope(dossier, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }

    const zip = new JSZip();
    let count = 0;

    // 1) Anexos
    for (const { field, label } of FILE_FIELDS) {
      const url = (dossier as any)[field] as string | undefined;
      const filePath = resolveUploadFile(url);
      if (!filePath) continue;
      const ext = path.extname(filePath) || '.bin';
      zip.file(`${label}${ext}`, fs.readFileSync(filePath));
      count++;
    }

    // 1b) Documentos avulsos (3 slots livres) — nome digitado por quem anexou,
    // senão viraria um arquivo sem identificação nenhuma dentro do ZIP.
    for (let i = 1; i <= 3; i++) {
      const url = (dossier as any)[`doc_extra_${i}_url`] as string | undefined;
      const filePath = resolveUploadFile(url);
      if (!filePath) continue;
      const nome = ((dossier as any)[`doc_extra_${i}_nome`] as string | undefined)?.trim() || `Documento avulso ${i}`;
      const safeName = nome.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const ext = path.extname(filePath) || '.bin';
      zip.file(`${safeName}${ext}`, fs.readFileSync(filePath));
      count++;
    }

    // 2) OS de Abertura (.docx) — incluída sempre que houver dados mínimos.
    try {
      const docx = await gerarOsAberturaDocx(dossier);
      const empresa = (dossier.empresa_nome || dossier.client_name || 'empresa')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .slice(0, 40);
      zip.file(`OS_Abertura_${empresa}.docx`, docx);
      count++;
    } catch (e) {
      console.error('Falha ao incluir DOCX no ZIP:', e);
    }

    // 3) Resumo com dados-chave
    zip.file('resumo.txt', buildResumoTxt(dossier));

    if (count === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo disponível nesta OS.' }, { status: 404 });
    }

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const nome = dossierFolderName(dossier).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);

    await Database.createLog({
      ip_address: getClientIp(request),
      dossier_id: id,
      user_name: session.name || 'Operador Nexus',
      action_type: 'FILES_ZIP_BAIXADO',
      details: `Baixou ZIP do dossiê com ${count} arquivo(s).`,
    });

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Dossie_${nome}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('Erro ao gerar ZIP:', e);
    return NextResponse.json({ error: 'Erro ao gerar o ZIP.' }, { status: 500 });
  }
}
