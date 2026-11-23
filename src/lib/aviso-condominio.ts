// Aviso no celular do condomínio (síndico, gerente ou zelador com acesso ao
// Painel) quando o técnico sai, chega e finaliza. Só pelo app (Web Push):
// o WhatsApp do condomínio entra quando a Amotex tiver o número próprio.
// Nunca lança: falha de aviso não derruba a ação do técnico.
import { Database, type OS } from './db';
import { enviarPushUsuarios } from './push';

export type EventoCondominio = 'a_caminho' | 'chegou' | 'finalizada';

function texto(evento: EventoCondominio, os: OS, tecnicoNome?: string | null): { titulo: string; corpo: string } {
  const quem = tecnicoNome || 'O técnico da Amotex';
  const servico = os.tipo === 'corretiva' ? 'o chamado' : 'a visita preventiva';
  if (evento === 'a_caminho') return { titulo: 'Técnico a caminho', corpo: `${quem} está a caminho para ${servico}.` };
  if (evento === 'chegou') return { titulo: 'Técnico chegou', corpo: `${quem} chegou ao condomínio.` };
  return { titulo: 'Serviço finalizado', corpo: `${quem} finalizou ${servico}. O relatório em PDF está no Painel.` };
}

export async function avisarCondominio(os: OS, evento: EventoCondominio): Promise<void> {
  try {
    const [usuarios, tecnico] = await Promise.all([
      Database.getUsers(),
      os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
    ]);
    const ids = usuarios
      .filter((u) => u.ativo !== false && u.papel === 'sindico' && u.condominio_id === os.condominio_id)
      .map((u) => u.id);
    if (ids.length === 0) return;
    const { titulo, corpo } = texto(evento, os, tecnico?.nome);
    await enviarPushUsuarios(ids, { titulo, corpo, url: `/painel/${os.condominio_id}`, tag: `os-${os.id}` });
  } catch (e) {
    console.error('[aviso-condominio] erro:', (e as Error)?.message);
  }
}
