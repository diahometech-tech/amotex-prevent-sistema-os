import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, podeOperarOS } from '@/lib/auth';
import { podeOperarCampo } from '@/lib/roles';
import { saveOsFotoDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/os/[id]/fotos  body: { momento: 'antes'|'depois', data: dataURL, client_id? }
// Gestor ou técnico (campo), só nas OS que vê. Cada foto é um arquivo próprio — não sobrescreve as
// anteriores (uma OS tem várias fotos de antes/depois).
// client_id vem da fila de envio do celular (src/lib/fila-envio.ts): com sinal
// ruim, a foto pode chegar e a resposta se perder; o reenvio com o mesmo id
// devolve a foto já gravada, sem duplicar.
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeOperarCampo(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  // Escrita: o técnico só mexe na OS que é dele (ver a OS de outro é só leitura).
  if (!podeOperarOS(session, os)) {
    return NextResponse.json({ error: 'Esta OS não está com você. Assuma a OS antes de mexer nela.' }, { status: 403 });
  }
  try {
    const { momento, data, client_id, equipamento_id } = await request.json();
    if (client_id !== undefined && (typeof client_id !== 'string' || !CLIENT_ID.test(client_id))) {
      return NextResponse.json({ error: 'Identificador do envio inválido.' }, { status: 400 });
    }
    // Reenvio da fila de uma foto que já foi gravada vem ANTES da trava de OS
    // encerrada: se a OS fechou enquanto o aparelho estava sem sinal, a foto
    // já está no PDF e o reenvio tem de ser aceito como repetido, não recusado.
    if (client_id) {
      const existente = await Database.getFotoByClientId(client_id);
      if (existente) {
        if (existente.os_id !== id) return NextResponse.json({ error: 'Identificador do envio já usado.' }, { status: 409 });
        return NextResponse.json({ success: true, foto: existente, repetido: true });
      }
    }
    // Upload em OS encerrada mudaria o registro que já virou PDF/assinatura.
    if (os.status === 'finalizada' || os.status === 'cancelada') {
      return NextResponse.json({ error: 'OS encerrada.' }, { status: 409 });
    }
    // Foto de equipamento (pedido 8): o equipamento tem que estar no
    // checklist DESTA OS — não aceita id solto de outro condomínio.
    if (equipamento_id !== undefined) {
      if (typeof equipamento_id !== 'string') {
        return NextResponse.json({ error: 'Equipamento inválido.' }, { status: 400 });
      }
      const checklist = await Database.getChecklistByOS(id);
      if (!checklist.some((i) => i.equipamento_id === equipamento_id)) {
        return NextResponse.json({ error: 'Este equipamento não está no checklist desta OS.' }, { status: 400 });
      }
      // O checklist sozinho não prova nada (item antigo pode apontar pra outro
      // prédio): confere também que o equipamento é do condomínio da OS.
      const equipamento = await Database.getEquipamentoById(equipamento_id);
      if (!equipamento || equipamento.condominio_id !== os.condominio_id) {
        return NextResponse.json({ error: 'Este equipamento não é deste condomínio.' }, { status: 400 });
      }
    }
    if (momento !== 'antes' && momento !== 'depois') {
      return NextResponse.json({ error: 'Informe o momento da foto: antes ou depois.' }, { status: 400 });
    }
    if (!data || typeof data !== 'string') {
      return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 });
    }
    const url = saveOsFotoDataUrl(data, id);
    if (!url) return NextResponse.json({ error: 'Formato de arquivo inválido (esperado data URL base64).' }, { status: 400 });

    const foto = await Database.createFoto({
      os_id: id,
      momento,
      url,
      client_id: client_id || undefined,
      equipamento_id: equipamento_id || undefined,
    });
    return NextResponse.json({ success: true, foto });
  } catch (e) {
    console.error('Erro no upload de foto:', e);
    return NextResponse.json({ error: 'Erro interno no upload.' }, { status: 500 });
  }
}
