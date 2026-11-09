// Validação do cadastro de equipamento — compartilhada entre o POST (novo) e o
// PATCH (editar). A foto vem à parte (data URL), salva por quem chama.
import type { Equipamento } from './db';
import { categoriaDoTipo, categoriaValida, CATEGORIA_OUTRO } from './catalogo-equipamentos';

function texto(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : undefined;
}

// Na edição (parcial), campo enviado vazio vira null = apagar (o UPDATE ignora
// só undefined).
type Dados = { [K in keyof Equipamento]?: Equipamento[K] | null };

export function validarEquipamento(
  body: Record<string, unknown>,
  parcial = false
): { dados: Partial<Equipamento>; erro?: string } {
  const dados: Dados = {};
  const ok = () => ({ dados: dados as Partial<Equipamento> });
  const falha = (erro: string) => ({ dados: {}, erro });
  if (!parcial || body.tipo !== undefined) {
    const tipo = texto(body.tipo, 120);
    if (!tipo) return falha('Informe o tipo do equipamento.');
    dados.tipo = tipo;
    // Categoria explícita vale; senão, a do catálogo pelo nome do tipo.
    if (body.categoria !== undefined && body.categoria !== '' && body.categoria !== null) {
      if (!categoriaValida(body.categoria)) return falha('Categoria inválida.');
      dados.categoria = body.categoria;
    } else {
      dados.categoria = categoriaDoTipo(tipo) ?? CATEGORIA_OUTRO;
    }
  }
  for (const campo of ['identificacao', 'modelo'] as const) {
    if (!parcial || body[campo] !== undefined) dados[campo] = texto(body[campo], 120) ?? (parcial ? null : undefined);
  }
  if (!parcial || body.potencia_hp !== undefined) {
    const v = body.potencia_hp;
    if (v === undefined || v === null || v === '') {
      if (parcial) dados.potencia_hp = null;
    } else {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 10000) return falha('Potência inválida.');
      dados.potencia_hp = n;
    }
  }
  return ok();
}
