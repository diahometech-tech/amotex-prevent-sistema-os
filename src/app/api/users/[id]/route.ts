import { NextRequest, NextResponse } from 'next/server';
import { Database, type User } from '@/lib/db';
import { getSessionFromRequest, canManageUsers, hashPassword } from '@/lib/auth';
import { isSecretaria, osEncerrada } from '@/lib/roles';
import { avaliarTrocaPapel, normalizarEspecialidade, normalizarTelegramChatId } from '@/lib/usuario-campos';
import { ROLE_LABELS } from '@/lib/permissions';
import { erroParaPlantao } from '@/lib/plantao';
import { usuariosComPush } from '@/lib/push';

function safe(u: User) {
  const { senha_hash: _senha_hash, ...rest } = u;
  return rest;
}

// PATCH /api/users/[id] — reseta senha, ativa/desativa, perfil (papel),
// especialidade do técnico, plantão e chat do Telegram. Admin; a secretária só
// mexe no plantão (e só de técnico).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  const soPlantao = !!session && isSecretaria(session.role);
  if (!session || !(canManageUsers(session.role) || soPlantao)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    if (soPlantao) {
      // Secretária: só {de_plantao}, em usuário técnico. Qualquer outro campo é 403.
      const campos = Object.keys(body ?? {});
      if (campos.length !== 1 || campos[0] !== 'de_plantao' || typeof body.de_plantao !== 'boolean') {
        return NextResponse.json({ error: 'Acesso negado. A secretária só marca o plantão.' }, { status: 403 });
      }
      const alvo = await Database.getUserById(id);
      if (!alvo) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
      if (alvo.papel !== 'tecnico') {
        return NextResponse.json({ error: 'O plantão é só dos técnicos.' }, { status: 403 });
      }
    }
    // Plantão (manual) só para quem tem canal de aviso. Vale o Telegram que
    // está sendo salvo junto, se vier no mesmo pedido.
    if (body.de_plantao === true) {
      const alvo = await Database.getUserById(id);
      if (!alvo) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
      const chat = body.telegram_chat_id !== undefined ? normalizarTelegramChatId(body.telegram_chat_id) : alvo.telegram_chat_id;
      const erro = erroParaPlantao({ id: alvo.id, nome: alvo.nome, telegram_chat_id: chat ?? undefined }, await usuariosComPush());
      if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    }
    const { senha, ativo, condominio_id } = body;
    const updates: Record<string, unknown> = {};
    if (typeof senha === 'string' && senha.length > 0) updates.senha_hash = hashPassword(senha);
    if (typeof ativo === 'boolean') updates.ativo = ativo;
    if (typeof body.de_plantao === 'boolean') updates.de_plantao = body.de_plantao;
    if (typeof condominio_id === 'string') updates.condominio_id = condominio_id;
    if (body.especialidade !== undefined) {
      const especialidade = normalizarEspecialidade(body.especialidade);
      if (especialidade === undefined) return NextResponse.json({ error: 'Especialidade inválida.' }, { status: 400 });
      updates.especialidade = especialidade;
    }
    if (body.telegram_chat_id !== undefined) {
      const chat = normalizarTelegramChatId(body.telegram_chat_id);
      if (chat === undefined) return NextResponse.json({ error: 'ID do Telegram inválido (só números).' }, { status: 400 });
      updates.telegram_chat_id = chat;
    }
    // Troca de perfil: por último, para a limpeza dos campos que não valem no
    // perfil novo (especialidade, plantão, condomínio) ganhar do resto do pedido.
    let trocaPapel: { de: User['papel']; para: User['papel'] } | null = null;
    let osEmAberto = 0;
    if (body.papel !== undefined) {
      const alvo = await Database.getUserById(id);
      if (!alvo) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
      const condominioId = typeof body.condominio_id === 'string' ? body.condominio_id : undefined;
      const condominioExiste = condominioId ? !!(await Database.getCondominioById(condominioId)) : false;
      const r = avaliarTrocaPapel({ alvo, novoPapel: body.papel, condominioId, sessaoId: session.id, condominioExiste });
      if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
      Object.assign(updates, r.campos);
      if (r.campos.papel !== alvo.papel) {
        trocaPapel = { de: alvo.papel, para: r.campos.papel };
        if (alvo.papel === 'tecnico') {
          osEmAberto = (await Database.getOSs()).filter((o) => o.tecnico_id === id && !osEncerrada(o)).length;
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    }
    const user = await Database.updateUser(id, updates);
    if (!user) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    let aviso: string | undefined;
    if (trocaPapel) {
      await Database.createAuditLog({
        entidade: 'usuario', entidade_id: id, acao: 'PERFIL_ALTERADO', ator: session.name,
        detalhe: { de: trocaPapel.de, para: trocaPapel.para },
      });
      if (osEmAberto > 0) {
        aviso = osEmAberto === 1
          ? '1 OS em aberto continua no nome desta pessoa: passe para outro técnico.'
          : `${osEmAberto} OS em aberto continuam no nome desta pessoa: passe para outro técnico.`;
      }
    }
    return NextResponse.json({
      success: true,
      user: safe(user),
      ...(trocaPapel ? { perfil: ROLE_LABELS[trocaPapel.para] } : {}),
      ...(aviso ? { aviso } : {}),
    });
  } catch (e) {
    console.error('Erro ao atualizar usuário:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/users/[id] — exclui o acesso permanentemente. Só admin.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { id } = await params;
  if (id === session.id) {
    return NextResponse.json({ error: 'Você não pode excluir o próprio acesso.' }, { status: 400 });
  }
  try {
    const removed = await Database.deleteUser(id);
    if (!removed) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    // Técnico com OS no histórico: a OS aponta pra ele (os.tecnico_id), o
    // banco recusa. Desativar mantém o nome nas OS e bloqueia o login.
    console.error('Erro ao excluir usuário:', e);
    return NextResponse.json(
      { error: 'Este acesso já tem OS no histórico e não pode ser excluído. Use "Desativar".' },
      { status: 409 }
    );
  }
}
