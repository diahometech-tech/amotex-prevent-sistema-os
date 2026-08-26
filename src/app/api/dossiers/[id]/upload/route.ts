import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp, isFieldRole } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';
import { exportDossierFolder } from '@/lib/dossie-export';
import { saveDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

// Campos de anexo permitidos (evita escrita arbitrária no dossiê).
const ALLOWED_FIELDS: Record<string, string> = {
  certificado_a1_url: 'Certificado A1',
  documento_b_url: 'Documento B (final)',
  cnpj_comprovante_url: 'Comprovante de CNPJ',
  inscricao_municipal_url: 'Inscrição Municipal',
  inscricao_estadual_url: 'Inscrição Estadual',
  opcao_simples_url: 'Opção do Simples Nacional',
  certidao_inteiro_teor_url: 'Certidão de Inteiro Teor',
  doc_extra_1_url: 'Documento avulso 1',
  doc_extra_2_url: 'Documento avulso 2',
  doc_extra_3_url: 'Documento avulso 3',
  photo_doc_frente_url: 'Documento — Frente',
  photo_doc_verso_url: 'Documento — Verso',
  photo_doc_completo_url: 'Documento — Completo',
  photo_cnh_url: 'CNH',
  photo_selfie_url: 'Selfie',
  photo_selfie_rg_url: 'Selfie + RG',
  video_prova_url: 'Prova de Vida (vídeo)',
};

// Documentos de identidade pessoal: só gestor/admin corrigem por aqui (pedido
// real — captador não subiu pelo sistema, mandou por WhatsApp, e o gestor
// não tinha como anexar/corrigir; antes esses campos só chegavam via
// /captador-update ou na captação inicial). Restrito além do gate geral
// (que já bloqueia captador/terceiro) — defesa em profundidade, mesmo padrão
// de CERT_FIELD_WRITE_ROLES em dossiers/[id]/route.ts.
const IDENTITY_FIELDS = new Set([
  'photo_doc_frente_url', 'photo_doc_verso_url', 'photo_doc_completo_url',
  'photo_cnh_url', 'photo_selfie_url', 'photo_selfie_rg_url', 'video_prova_url',
]);

// POST /api/dossiers/[id]/upload  body: { field, data (data URL), operator_name }
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  // Upload de anexos operacionais exige sessão; captador e terceiro não anexam
  // documentos da esteira (captador usa /captador-update).
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  // certificador também é bloqueado aqui: este endpoint devolve o dossiê
  // inteiro na resposta (`updated`), o que violaria a whitelist do Modo
  // Consulta mesmo que a UI não renderize os campos extras — o A1 desse
  // papel entra por /api/consulta/dossiers/[id]/a1, que responde só o
  // necessário.
  if (isFieldRole(session.role)) {
    return NextResponse.json({ error: 'Seu perfil não tem permissão para anexar documentos.' }, { status: 403 });
  }
  try {
    // operator_name (client-supplied) não é mais usado como identidade de
    // auditoria — mesmo fix de dossiers/[id]/route.ts, ver comentário lá.
    const { field, data, original_name } = await request.json();

    if (!field || !ALLOWED_FIELDS[field]) {
      return NextResponse.json({ error: 'Campo de anexo inválido.' }, { status: 400 });
    }
    if (IDENTITY_FIELDS.has(field) && session.role !== 'gestor' && session.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas gestor ou admin podem anexar documentos de identidade por aqui.' }, { status: 403 });
    }
    if (!data || typeof data !== 'string') {
      return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 });
    }

    const dossier = await Database.getDossierById(id);
    if (!dossier) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }

    if (session.role === 'gestor') {
      // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts).
      const escopo = await getGestorScope(session);
      if (!dossierInGestorScope(dossier, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }

    const url = saveDataUrl(data, field, id);
    if (!url) {
      return NextResponse.json({ error: 'Formato de arquivo inválido (esperado data URL base64).' }, { status: 400 });
    }

    // Nome original do arquivo anexado (10/08/2026, pedido real: download do
    // Certificado A1 aparecia com o nome interno do campo, não do arquivo).
    // Só persistido pra certificado_a1_url — os demais campos já têm nome
    // amigável fixo em FILE_FIELDS/ALLOWED_FIELDS, não precisam disso.
    const fieldUpdates: Record<string, string> = { [field]: url };
    if (field === 'certificado_a1_url' && typeof original_name === 'string' && original_name.trim()) {
      fieldUpdates.certificado_a1_nome = original_name.trim();
    }
    const updated = await Database.updateDossier(id, fieldUpdates);
    // Anexo avulso: usa o nome digitado por quem anexou (se já preenchido) em
    // vez do rótulo genérico "Documento avulso N", pra ficar identificável na
    // trilha de auditoria também.
    const nomeField = field.replace(/_url$/, '_nome');
    const label = (dossier as unknown as Record<string, string>)[nomeField] || ALLOWED_FIELDS[field];
    await Database.createLog({
      ip_address: getClientIp(request),
      dossier_id: id,
      user_name: session.name,
      action_type: 'FILE_UPLOADED',
      details: `Anexou arquivo: ${label}.`,
    });

    // A exportação do dossiê completo (DOSSIES_DIR, sincronizada via Syncthing
    // com o servidor interno da Contex) só acontece automaticamente no momento
    // da finalização. Se o anexo chegou DEPOIS da OS já estar finalizada
    // (ex.: reenvio de um documento que faltava), a pasta já exportada fica
    // desatualizada — então reexporta aqui pra manter a pasta em dia.
    if (updated?.empresa_aberta) {
      try {
        const dir = await exportDossierFolder(updated);
        await Database.createLog({
      ip_address: getClientIp(request),
          dossier_id: id,
          user_name: 'Sistema NexusFlow',
          action_type: 'DOSSIE_EXPORTADO',
          details: `Dossiê reexportado após anexo pós-finalização: ${dir}`,
        });
      } catch (e) {
        console.error('Falha ao reexportar dossiê após upload:', e);
      }
    }

    return NextResponse.json({ success: true, field, url, dossier: updated });
  } catch (e) {
    console.error('Erro no upload de anexo:', e);
    return NextResponse.json({ error: 'Erro interno no upload.' }, { status: 500 });
  }
}
