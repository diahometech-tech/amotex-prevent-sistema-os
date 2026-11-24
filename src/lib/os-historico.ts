// Histórico da OS em frases — função pura, sem I/O.
//
// O log de auditoria guarda `acao` (código), `ator` (nome de quem fez) e
// `detalhe` (JSON com ids e IP). A tela nunca mostra isso cru: aqui cada
// evento vira uma frase em português. IP nunca entra na frase. Evento que não
// conhecemos vira "Alteração registrada por X", nunca JSON.
import type { UserRole } from './db';
import { FUSO_OPERACAO } from './os-agenda';

export interface EventoHistorico {
  acao: string;
  ator: string;
  detalhe?: unknown;
  criado_em: string;
}

export interface PessoaHistorico {
  id: string;
  nome: string;
  papel: UserRole;
}

const STATUS: Record<string, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const PAPEL_DO_ATOR: Record<UserRole, string> = {
  admin: 'gestor',
  secretaria: 'secretária',
  tecnico: '', // técnico aparece só pelo nome
  sindico: 'síndico',
};

const ATORES_AUTOMATICOS: Record<string, string> = {
  sistema: 'o sistema',
  hermes: 'o Hermes (automático)',
  n8n: 'o sistema',
  usuario: '',
};

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** "2026-11-20" -> "20/11". Qualquer outra coisa volta como veio. */
function diaCurto(v: unknown): string {
  const s = texto(v);
  const m = s?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : s ?? '';
}

function partes(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_OPERACAO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { dia: `${o.day}/${o.month}`, ano: o.year, hora: `${o.hour === '24' ? '00' : o.hour}:${o.minute}` };
}

/** "20/11 às 23:50" no fuso de São Paulo. */
export function quandoCurto(iso: string | undefined): string {
  const p = partes(iso);
  return p ? `${p.dia} às ${p.hora}` : '';
}

/** "20/11/2026 às 23:50" no fuso de São Paulo. */
export function quandoCompleto(iso: string | undefined): string {
  const p = partes(iso);
  return p ? `${p.dia}/${p.ano} às ${p.hora}` : '';
}

export function descreverEvento(ev: EventoHistorico, pessoas: PessoaHistorico[] = []): string {
  const porId = (id: unknown) => {
    const v = texto(id);
    return v ? pessoas.find((p) => p.id === v) : undefined;
  };
  const nomeDoId = (id: unknown) => porId(id)?.nome ?? 'um técnico';

  const automatico = ATORES_AUTOMATICOS[ev.ator.trim().toLowerCase()];
  const ator = pessoas.find((p) => p.nome === ev.ator);
  // Sujeito da frase: "Ana (secretária)", "Mateus", "O sistema".
  const quem = (() => {
    if (automatico !== undefined) return automatico ? automatico[0].toUpperCase() + automatico.slice(1) : 'Alguém';
    const papel = ator ? PAPEL_DO_ATOR[ator.papel] : '';
    return papel ? `${ev.ator} (${papel})` : ev.ator;
  })();
  // "por X" no fim da frase.
  const por = (() => {
    if (automatico !== undefined) return automatico || 'um usuário';
    const papel = ator ? PAPEL_DO_ATOR[ator.papel] : '';
    return papel ? `${ev.ator} (${papel})` : ev.ator;
  })();
  const d = objeto(ev.detalhe);

  switch (ev.acao) {
    case 'CRIADA': {
      if (ev.ator === 'hermes') return 'OS aberta automaticamente pelo Hermes';
      const tipo = d.tipo === 'corretiva' ? 'Corretiva' : d.tipo === 'preventiva' ? 'Preventiva' : 'OS';
      return `${tipo} aberta por ${por}`;
    }
    case 'STATUS_ALTERADO': {
      const de = STATUS[String(d.de)] ?? texto(d.de) ?? '?';
      const para = STATUS[String(d.para)] ?? texto(d.para) ?? '?';
      return `Status: ${de} → ${para}`;
    }
    case 'TECNICO_ATRIBUIDO': {
      const de = texto(d.de);
      const para = texto(d.para);
      if (!para) return `${quem} tirou o técnico${de ? ` (${nomeDoId(de)})` : ''} da OS`;
      if (!de) {
        if (ator && ator.id === para) return `${ev.ator} assumiu a OS`;
        return `${quem} atribuiu a OS a ${nomeDoId(para)}`;
      }
      return `${quem} trocou o técnico de ${nomeDoId(de)} para ${nomeDoId(para)}`;
    }
    case 'CHEGADA_REGISTRADA': {
      const hora = partes(texto(d.em))?.hora ?? partes(ev.criado_em)?.hora;
      return `Chegada registrada${hora ? ` às ${hora}` : ''}`;
    }
    case 'REAGENDADA_AUTOMATICA':
      return `Visita remarcada de ${diaCurto(d.de)} para ${diaCurto(d.para)} (reorganização automática)`;
    case 'REAGENDADA_NA_CHEGADA':
      return `Visita remarcada de ${diaCurto(d.de)} para ${diaCurto(d.para)} (técnico chegou em outro dia)`;
    case 'FINALIZADA':
      return `OS finalizada por ${por}`;
    case 'CANCELADA': {
      const motivo = texto(d.motivo);
      return `OS cancelada por ${por}${motivo ? `. Motivo: ${motivo}` : ''}`;
    }
    case 'CHECKLIST_DESMARCADO': {
      const item = texto(d.descricao);
      return `${quem} desmarcou um item do checklist${item ? `: ${item}` : ''}`;
    }
    case 'FOTO_REMOVIDA': {
      const momento = d.momento === 'antes' ? ' do antes' : d.momento === 'depois' ? ' do depois' : '';
      return `${quem} removeu uma foto${momento}`;
    }
    case 'A_CAMINHO':
      return `${texto(d.tecnico) ?? quem} avisou que está a caminho`;
    case 'AVISO_CANCELAMENTO': {
      const nomes = Array.isArray(d.destinatarios) ? d.destinatarios.filter((n): n is string => typeof n === 'string') : [];
      return `Aviso de cancelamento enviado${nomes.length > 0 ? ` para ${nomes.join(', ')}` : ''}`;
    }
    case 'CORRETIVA_ABERTA':
      return `Corretiva aberta a partir desta OS por ${por}`;
    case 'AVISO_ABERTURA':
    case 'AVISO_ATRIBUICAO':
    case 'AVISO_ASSUMIDA': {
      const nomes = Array.isArray(d.destinatarios) ? d.destinatarios.filter((n): n is string => typeof n === 'string') : [];
      const quemRecebeu = nomes.length > 0 ? ` para ${nomes.join(', ')}` : '';
      return ev.acao === 'AVISO_ASSUMIDA'
        ? `Aviso de OS assumida enviado${quemRecebeu}`
        : `Aviso de corretiva enviado${quemRecebeu}`;
    }
    default:
      return `Alteração registrada por ${por}`;
  }
}
