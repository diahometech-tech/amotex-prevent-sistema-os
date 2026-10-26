// Resumo diário pro gestor no Telegram (pedido de 26/10: "deve ter algum
// aviso e acompanhamento para o gestor"). Puro: recebe os dados, devolve o
// texto. Quem busca e entrega é /api/integracoes/resumo-diario + n8n.
import type { Cobranca, Condominio, OS, Reajuste } from '../db';
import { formatarReais } from './dinheiro';
import { statusEfetivo } from './cobranca';
import { reajustesPendentes } from './reajuste';
import { slaChegada } from '../os-sla';
import { montarRotaDoDia } from '../os-agenda';
import { escaparMarkdown } from '../telegram-texto';

export function resumoDiarioGestor({
  hoje, agora, condominios, cobrancas, reajustes, oss,
}: {
  hoje: string; agora: number; condominios: Condominio[]; cobrancas: Cobranca[]; reajustes: Reajuste[]; oss: OS[];
}): { mensagem: string; temAlgo: boolean } {
  const linhas: string[] = [];
  const pend = reajustesPendentes(condominios, reajustes, hoje);
  const vencidos = pend.filter((p) => p.dias < 0);
  const aVencer = pend.filter((p) => p.dias >= 0);
  if (pend.length) {
    const partes = [
      aVencer.length && `${aVencer.length} vence${aVencer.length > 1 ? 'm' : ''} em até 30 dias`,
      vencidos.length && `${vencidos.length} já passou${vencidos.length > 1 ? 'aram' : ''} do aniversário sem reajuste`,
    ].filter(Boolean);
    linhas.push(`📈 *Reajustes*: ${partes.join(', ')}.`);
    for (const p of pend.slice(0, 5)) {
      linhas.push(`   • ${escaparMarkdown(p.nome)} — ${p.dias < 0 ? `aniversário há ${-p.dias} dias` : p.dias === 0 ? 'aniversário hoje' : `em ${p.dias} dias`} (${formatarReais(p.valor_atual_centavos)})`);
    }
    if (pend.length > 5) linhas.push(`   • … e mais ${pend.length - 5}`);
  }
  const aguardando = reajustes.filter((r) => r.status === 'enviado');
  if (aguardando.length) linhas.push(`✉️ ${aguardando.length} aviso${aguardando.length > 1 ? 's' : ''} de reajuste aguardando resposta do condomínio.`);

  const atrasadas = cobrancas.filter((c) => statusEfetivo(c, hoje) === 'atrasada');
  if (atrasadas.length) {
    const valor = atrasadas.reduce((acc, c) => acc + c.valor_previsto_centavos - (c.valor_recebido_centavos ?? 0), 0);
    linhas.push(`💰 *Cobranças atrasadas*: ${atrasadas.length} (${formatarReais(valor)}).`);
  }
  const estouradas = oss.filter((o) => slaChegada(o, agora)?.situacao === 'estourado');
  if (estouradas.length) linhas.push(`🚨 *Corretivas fora do prazo de 3h*: ${estouradas.length}.`);
  const rota = montarRotaDoDia(oss.filter((o) => o.tipo === 'preventiva'), hoje, hoje);
  if (rota.doDia.length || rota.atrasadas.length) {
    linhas.push(`🧰 Preventivas hoje: ${rota.doDia.length}${rota.atrasadas.length ? ` (+${rota.atrasadas.length} atrasadas)` : ''}.`);
  }
  const temAlgo = linhas.length > 0;
  const [a, m, d] = hoje.split('-');
  return {
    temAlgo,
    mensagem: [`*Bom dia! Resumo Amotex — ${d}/${m}/${a}*`, '', ...(temAlgo ? linhas : ['Nada pendente hoje.'])].join('\n'),
  };
}
