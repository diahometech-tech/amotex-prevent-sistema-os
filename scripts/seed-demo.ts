// Dados de demonstração — pra apresentação visual ao contratante (gravação
// de tela ou ao vivo), não pra testar regra de negócio (isso é o
// scripts/seed.ts). Mais condomínios, mais OS espalhadas por status/tipo/
// prioridade/tempo em aberto, e pelo menos duas OS finalizadas com fotos,
// assinaturas e PDF de verdade — pra mostrar o fluxo completo, não só a
// lista vazia.
//
// Roda contra o backend JSON local por padrão. Mesma trava do seed.ts:
// recusa contra Postgres de produção sem --force explícito.
//
// Rodar num banco limpo (apague src/lib/local_db.json antes) — este script
// só ADICIONA registros, então rodar duas vezes duplica tudo.
//
// Uso: npm run seed:demo

import { Database } from '../src/lib/db';
import { saveOsFotoDataUrl, saveAssinaturaDataUrl, saveOsPdfBuffer } from '../src/lib/uploads';
import { generateOsPdf } from '../src/lib/os-pdf';
import type { OsTipo, OsPrioridade } from '../src/lib/db';
import zlib from 'zlib';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------
// PNG sólido gerado na mão (sem dependência de imagem) — só precisa abrir
// no navegador e ser embutível no PDF (pdfkit só aceita JPEG/PNG nativo).
// Não é uma foto real, é um placeholder colorido pra preencher a tela.
// ---------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

// Canvas RGB cru em memória — base pro placeholder de foto (preenchimento
// sólido) e pro de assinatura (traço desenhado por cima).
class Canvas {
  readonly pixels: Buffer;
  constructor(readonly width: number, readonly height: number, bg: [number, number, number]) {
    this.pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.pixels[i * 3] = bg[0]; this.pixels[i * 3 + 1] = bg[1]; this.pixels[i * 3 + 2] = bg[2];
    }
  }
  setPixel(x: number, y: number, [r, g, b]: [number, number, number]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.pixels[i] = r; this.pixels[i + 1] = g; this.pixels[i + 2] = b;
  }
  // Bresenham com uma espessura simples (pinta um quadradinho por passo) —
  // suficiente pra um traço de assinatura visível, não precisa ser bonito.
  drawLine(x0: number, y0: number, x1: number, y1: number, color: [number, number, number], thickness = 2) {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let ox = -thickness; ox <= thickness; ox++) {
        for (let oy = -thickness; oy <= thickness; oy++) this.setPixel(x + ox, y + oy, color);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  toPng(): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type RGB

    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const rowStart = y * (this.width * 3 + 1);
      raw[rowStart] = 0; // filtro: nenhum
      this.pixels.copy(raw, rowStart + 1, y * this.width * 3, (y + 1) * this.width * 3);
    }

    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function pngDataUrl(width: number, height: number, color: [number, number, number]): string {
  return `data:image/png;base64,${new Canvas(width, height, color).toPng().toString('base64')}`;
}

// Traço tipo rabisco de assinatura (não é OCR nem precisa ser bonito) — só
// não pode parecer campo vazio na tela de Assinaturas do modal.
function signatureDataUrl(width: number, height: number): string {
  const canvas = new Canvas(width, height, [255, 255, 255]);
  const ink: [number, number, number] = [30, 40, 90];
  const pontos: [number, number][] = [
    [width * 0.08, height * 0.6], [width * 0.2, height * 0.3], [width * 0.3, height * 0.7],
    [width * 0.4, height * 0.35], [width * 0.5, height * 0.65], [width * 0.6, height * 0.25],
    [width * 0.72, height * 0.6], [width * 0.85, height * 0.4], [width * 0.93, height * 0.55],
  ];
  for (let i = 0; i < pontos.length - 1; i++) {
    canvas.drawLine(Math.round(pontos[i][0]), Math.round(pontos[i][1]), Math.round(pontos[i + 1][0]), Math.round(pontos[i + 1][1]), ink, 1);
  }
  return `data:image/png;base64,${canvas.toPng().toString('base64')}`;
}

function horasAtras(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

// ---------------------------------------------------------------------

interface OsBase {
  condominio_id: string;
  tipo: OsTipo;
  prioridade: OsPrioridade;
  observacao?: string;
  tecnico_id?: string;
  alerta_id?: string;
  origem?: 'manual' | 'hermes_automatica';
}

// OS aberta ou em andamento, sem evidências — a maioria dos casos reais.
async function criarOsSimples(base: OsBase, opts: { horasDesdeCriacao: number; emAndamento?: boolean; checklistParcial?: { equipamentoId?: string; descricao: string; obrigatorio: boolean; concluir: boolean }[] }) {
  const os = await Database.createOS({
    condominio_id: base.condominio_id, tipo: base.tipo, origem: base.origem || 'manual',
    alerta_id: base.alerta_id, prioridade: base.prioridade, tecnico_id: base.tecnico_id, observacao: base.observacao,
  });
  const criadoEm = horasAtras(opts.horasDesdeCriacao);
  const updates: Record<string, unknown> = { criado_em: criadoEm };
  if (opts.emAndamento) {
    updates.status = 'em_andamento';
    updates.entrada_em = horasAtras(Math.max(0, opts.horasDesdeCriacao - 0.5));
  }
  await Database.updateOS(os.id, updates);
  for (const item of opts.checklistParcial ?? []) {
    const criado = await Database.createChecklistItem({ os_id: os.id, equipamento_id: item.equipamentoId, descricao: item.descricao, obrigatorio: item.obrigatorio });
    if (item.concluir) await Database.concluirChecklistItem(criado.id);
  }
  return os.id;
}

// OS finalizada COM evidência completa: checklist ok, fotos antes/depois,
// assinaturas e PDF gerado de verdade (mesmo generateOsPdf do fluxo real em
// src/app/api/os/[id]/route.ts) — pra mostrar o pacote inteiro no demo.
async function criarOsFinalizadaComEvidencia(base: OsBase, opts: { equipamentoId?: string; diasAtras: number }) {
  const os = await Database.createOS({
    condominio_id: base.condominio_id, tipo: base.tipo, origem: 'manual',
    prioridade: base.prioridade, tecnico_id: base.tecnico_id, observacao: base.observacao,
  });
  const criadoEm = new Date(Date.now() - opts.diasAtras * 24 * 3600_000);
  await Database.updateOS(os.id, {
    criado_em: criadoEm.toISOString(),
    entrada_em: new Date(criadoEm.getTime() + 30 * 60_000).toISOString(),
  });

  const item = await Database.createChecklistItem({
    os_id: os.id, equipamento_id: opts.equipamentoId,
    descricao: 'Inspeção e manutenção conforme checklist padrão', obrigatorio: true,
  });
  await Database.concluirChecklistItem(item.id);

  const fotoAntes = saveOsFotoDataUrl(pngDataUrl(640, 480, [138, 97, 62]), os.id);
  const fotoDepois = saveOsFotoDataUrl(pngDataUrl(640, 480, [58, 122, 173]), os.id);
  if (fotoAntes) await Database.createFoto({ os_id: os.id, momento: 'antes', url: fotoAntes });
  if (fotoDepois) await Database.createFoto({ os_id: os.id, momento: 'depois', url: fotoDepois });

  const assinaturaZelador = saveAssinaturaDataUrl(signatureDataUrl(300, 120), os.id, 'zelador');
  const assinaturaTecnico = saveAssinaturaDataUrl(signatureDataUrl(300, 120), os.id, 'tecnico');

  const finalizada = await Database.finalizarOS(os.id, {
    assinatura_zelador_url: assinaturaZelador ?? undefined,
    assinatura_tecnico_url: assinaturaTecnico ?? undefined,
  });
  if (!finalizada) throw new Error('Falha ao finalizar OS de demonstração ' + os.id);

  const [checklist, fotos, condominio, tecnico] = await Promise.all([
    Database.getChecklistByOS(os.id),
    Database.getFotosByOS(os.id),
    Database.getCondominioById(finalizada.condominio_id),
    finalizada.tecnico_id ? Database.getUserById(finalizada.tecnico_id) : Promise.resolve(null),
  ]);
  if (condominio) {
    const buffer = await generateOsPdf({ os: finalizada, condominio, checklist, fotos, tecnico });
    await Database.updateOS(os.id, { pdf_url: saveOsPdfBuffer(buffer, os.id) });
  }
  return os.id;
}

async function main() {
  if (process.env.DATABASE_URL && !process.argv.includes('--force')) {
    console.error(
      'RECUSADO: DATABASE_URL está definido — este seed gravaria dados fictícios ' +
      'num banco Postgres real.\nSe é mesmo o que você quer: npm run seed:demo -- --force'
    );
    process.exit(1);
  }

  console.log('Seed de demonstração iniciado (backend: ' + (process.env.DATABASE_URL ? 'Postgres' : 'JSON local') + ')');

  // Técnicos nomeados — pra "Roberto Silva" aparecer na Rota/Dashboard em
  // vez do genérico "Técnico" do defaultUsers().
  const carlos = await Database.createUser({ nome: 'Carlos Mendes', login: 'carlos.mendes', senha: 'demo123', papel: 'tecnico' });
  const roberto = await Database.createUser({ nome: 'Roberto Silva', login: 'roberto.silva', senha: 'demo123', papel: 'tecnico' });

  // ===== 1. Residencial Jardim das Flores (Vila Mariana) =====
  const jardim = await Database.createCondominio({
    nome: 'Residencial Jardim das Flores', endereco: 'Rua das Acácias, 245 — Vila Mariana, São Paulo/SP',
    administradora: 'Administradora Silva & Cia', monitoramento_ativo: true,
  });
  const jardimTorre = await Database.createReservatorio({ condominio_id: jardim.id, nome_interno: 'Caixa Torre 01', nome_sensorlog: 'Caixa torre 03', tipo: 'torre', capacidade_litros: 15000 });
  await Database.createReservatorio({ condominio_id: jardim.id, nome_interno: 'Cisterna Térreo', nome_sensorlog: 'Cisterna Jardim Flores', tipo: 'cisterna', capacidade_litros: 30000 });
  await Database.createContato({ condominio_id: jardim.id, papel: 'zelador', nome: 'Seu Antônio', canal_preferencial: 'whatsapp', identificador_canal: '11987654321', nivel_escalonamento: 1 });
  await Database.createContato({ condominio_id: jardim.id, papel: 'sindico', nome: 'Marisa Oliveira', canal_preferencial: 'whatsapp', identificador_canal: '11976543210', nivel_escalonamento: 2 });
  await Database.createContato({ condominio_id: jardim.id, papel: 'conservadora', nome: 'Amotex — Plantão', canal_preferencial: 'telegram', identificador_canal: '@amotex_plantao', nivel_escalonamento: 3 });
  const bombaJardim = await Database.createEquipamento({ condominio_id: jardim.id, tipo: 'Bomba d\'água', modelo: 'Schneider BC-92 1CV', potencia_hp: 1 });
  await Database.createEquipamento({ condominio_id: jardim.id, tipo: 'Boia elétrica', modelo: 'Fluir Boia Náutica' });
  await Database.createUser({ nome: 'Marisa Oliveira', login: 'marisa.sindica', senha: 'sindica123', papel: 'sindico', condominio_id: jardim.id });

  await criarOsSimples(
    { condominio_id: jardim.id, tipo: 'corretiva', prioridade: 'alta', observacao: 'Bomba não está ligando desde ontem à noite — zelador reportou por WhatsApp.' },
    { horasDesdeCriacao: 1, checklistParcial: [
      { equipamentoId: bombaJardim.id, descricao: 'Verificar alimentação elétrica da bomba', obrigatorio: true, concluir: true },
      { equipamentoId: bombaJardim.id, descricao: 'Testar capacitor de partida', obrigatorio: true, concluir: false },
    ] }
  );
  await criarOsFinalizadaComEvidencia(
    { condominio_id: jardim.id, tipo: 'preventiva', prioridade: 'baixa', observacao: 'Visita mensal de rotina.', tecnico_id: carlos.id },
    { equipamentoId: bombaJardim.id, diasAtras: 5 }
  );
  const alertaJardim = await Database.createAlerta({ reservatorio_id: jardimTorre.id, evento: 'NIVEL_MUITO_BAIXO', texto_original: '⚠️ Caixa torre 03: nível em 8% — risco de desabastecimento em ~2h.', classificado_por: 'regra' });
  await criarOsSimples(
    { condominio_id: jardim.id, tipo: 'corretiva', prioridade: 'alta', origem: 'hermes_automatica', alerta_id: alertaJardim.id, observacao: 'OS aberta automaticamente pelo Hermes — nível muito baixo sem confirmação de ACK em 15min.' },
    { horasDesdeCriacao: 0.3 }
  );
  await criarOsSimples(
    { condominio_id: jardim.id, tipo: 'preventiva', prioridade: 'media', observacao: 'Verificação trimestral pendente.' },
    { horasDesdeCriacao: 72 } // > 48h: escala pra "Alta" na escala visual
  );

  // ===== 2. Edifício Bela Vista (Av. Paulista) =====
  const belaVista = await Database.createCondominio({ nome: 'Edifício Bela Vista', endereco: 'Av. Paulista, 1800 — Bela Vista, São Paulo/SP', monitoramento_ativo: true });
  const belaVistaCisterna = await Database.createReservatorio({ condominio_id: belaVista.id, nome_interno: 'Cisterna Subsolo', nome_sensorlog: 'Bela Vista - Cisterna', tipo: 'cisterna', capacidade_litros: 50000 });
  await Database.createReservatorio({ condominio_id: belaVista.id, nome_interno: 'Caixa Superior', nome_sensorlog: 'Bela Vista - Superior', tipo: 'superior', capacidade_litros: 20000 });
  await Database.createContato({ condominio_id: belaVista.id, papel: 'zelador', nome: 'João Batista', canal_preferencial: 'telegram', identificador_canal: '@joaobatista_zelador', nivel_escalonamento: 1 });
  await Database.createContato({ condominio_id: belaVista.id, papel: 'administradora', nome: 'Gestão Predial Bela Vista', canal_preferencial: 'email', identificador_canal: 'contato@gestaobelavista.com.br', nivel_escalonamento: 2 });
  const bombaBelaVista = await Database.createEquipamento({ condominio_id: belaVista.id, tipo: 'Bomba d\'água', modelo: 'Grundfos CR-3 2CV', potencia_hp: 2 });

  await criarOsSimples(
    { condominio_id: belaVista.id, tipo: 'preventiva', prioridade: 'media', tecnico_id: carlos.id },
    { horasDesdeCriacao: 0.7, emAndamento: true, checklistParcial: [
      { equipamentoId: bombaBelaVista.id, descricao: 'Verificar ruído e vibração da bomba', obrigatorio: true, concluir: false },
      { descricao: 'Registrar nível dos reservatórios', obrigatorio: false, concluir: false },
    ] }
  );
  await criarOsFinalizadaComEvidencia(
    { condominio_id: belaVista.id, tipo: 'corretiva', prioridade: 'alta', observacao: 'Vazamento no registro da caixa superior — resolvido em campo.', tecnico_id: roberto.id },
    { equipamentoId: bombaBelaVista.id, diasAtras: 2 }
  );
  const osCancelada = await Database.createOS({ condominio_id: belaVista.id, tipo: 'preventiva', origem: 'manual', prioridade: 'baixa', observacao: 'Duplicada por engano — cancelada.' });
  await Database.updateOS(osCancelada.id, { status: 'cancelada', criado_em: horasAtras(30) });
  await Database.createAlerta({ reservatorio_id: belaVistaCisterna.id, evento: 'SEM_REPORTE', classificado_por: 'regra' });

  // ===== 3. Condomínio Parque das Águas (Morumbi) =====
  const parque = await Database.createCondominio({ nome: 'Condomínio Parque das Águas', endereco: 'Av. Giovanni Gronchi, 4300 — Morumbi, São Paulo/SP', administradora: 'Morumbi Administradora Predial', monitoramento_ativo: true });
  const parqueCisterna = await Database.createReservatorio({ condominio_id: parque.id, nome_interno: 'Cisterna Geral', nome_sensorlog: 'Parque Águas - Cisterna', tipo: 'cisterna', capacidade_litros: 40000 });
  await Database.createReservatorio({ condominio_id: parque.id, nome_interno: 'Caixa D\'água Bloco A', nome_sensorlog: 'Parque Águas - Bloco A', tipo: 'torre', capacidade_litros: 12000 });
  await Database.createContato({ condominio_id: parque.id, papel: 'zelador', nome: 'Marcos Souza', canal_preferencial: 'whatsapp', identificador_canal: '11991234567', nivel_escalonamento: 1 });
  await Database.createContato({ condominio_id: parque.id, papel: 'sindico', nome: 'Fernanda Lima', canal_preferencial: 'email', identificador_canal: 'fernanda.lima@parqueaguas.com.br', nivel_escalonamento: 2 });
  const bombaParque = await Database.createEquipamento({ condominio_id: parque.id, tipo: 'Bomba d\'água', modelo: 'WEG 1050', potencia_hp: 1.5 });
  await Database.createEquipamento({ condominio_id: parque.id, tipo: 'Pressurizador', modelo: 'Rowa RP-200' });

  await criarOsSimples(
    { condominio_id: parque.id, tipo: 'corretiva', prioridade: 'alta', observacao: 'Pressão baixa relatada por vários moradores do Bloco A.' },
    { horasDesdeCriacao: 5, checklistParcial: [ { equipamentoId: bombaParque.id, descricao: 'Checar pressostato', obrigatorio: true, concluir: false } ] } // > 4h: escala pra "Urgente"
  );
  await criarOsSimples(
    { condominio_id: parque.id, tipo: 'preventiva', prioridade: 'baixa', tecnico_id: carlos.id },
    { horasDesdeCriacao: 24 }
  );
  await Database.createAlerta({ reservatorio_id: parqueCisterna.id, evento: 'NIVEL_CRITICO', texto_original: 'Cisterna Geral: nível crítico, 4% da capacidade.', classificado_por: 'llm' });

  // ===== 4. Edifício Solar dos Ipês (Moema) =====
  const solar = await Database.createCondominio({ nome: 'Edifício Solar dos Ipês', endereco: 'Rua Joaquim Nabuco, 512 — Moema, São Paulo/SP', administradora: 'Ipês Gestão Condominial', monitoramento_ativo: true });
  const solarCaixa = await Database.createReservatorio({ condominio_id: solar.id, nome_interno: 'Caixa Superior', nome_sensorlog: 'Solar Ipês - Superior', tipo: 'superior', capacidade_litros: 18000 });
  await Database.createReservatorio({ condominio_id: solar.id, nome_interno: 'Cisterna', nome_sensorlog: 'Solar Ipês - Cisterna', tipo: 'cisterna', capacidade_litros: 35000 });
  await Database.createContato({ condominio_id: solar.id, papel: 'zelador', nome: 'Paulo Ricardo', canal_preferencial: 'whatsapp', identificador_canal: '11998877665', nivel_escalonamento: 1 });
  await Database.createContato({ condominio_id: solar.id, papel: 'conservadora', nome: 'Amotex — Plantão', canal_preferencial: 'telegram', identificador_canal: '@amotex_plantao', nivel_escalonamento: 2 });
  const bombaSolar = await Database.createEquipamento({ condominio_id: solar.id, tipo: 'Bomba d\'água', modelo: 'Schneider BC-92 1CV', potencia_hp: 1 });

  const alertaSolar = await Database.createAlerta({ reservatorio_id: solarCaixa.id, evento: 'TENDENCIA_QUEDA_MADRUGADA', texto_original: 'Queda de nível atípica entre 2h e 4h — possível vazamento noturno.', classificado_por: 'llm' });
  await criarOsSimples(
    { condominio_id: solar.id, tipo: 'corretiva', prioridade: 'alta', origem: 'hermes_automatica', alerta_id: alertaSolar.id, observacao: 'OS aberta automaticamente pelo Hermes — padrão de queda noturna incomum.' },
    { horasDesdeCriacao: 0.2, checklistParcial: [ { equipamentoId: bombaSolar.id, descricao: 'Investigar possível vazamento na tubulação', obrigatorio: true, concluir: false } ] }
  );
  const osSolarFinalizada = await Database.createOS({ condominio_id: solar.id, tipo: 'preventiva', origem: 'manual', prioridade: 'baixa', observacao: 'Manutenção preventiva trimestral.' });
  const itemSolar = await Database.createChecklistItem({ os_id: osSolarFinalizada.id, equipamento_id: bombaSolar.id, descricao: 'Inspeção visual geral', obrigatorio: true });
  await Database.concluirChecklistItem(itemSolar.id);
  await Database.finalizarOS(osSolarFinalizada.id, {});
  await Database.updateOS(osSolarFinalizada.id, { criado_em: horasAtras(96) });
  await Database.createAlerta({ reservatorio_id: solarCaixa.id, evento: 'RECUPEROU', classificado_por: 'regra' });

  // ===== 5. Residencial Vista Verde (Alto de Pinheiros) — sem monitoramento, recém-cadastrado =====
  const vistaVerde = await Database.createCondominio({ nome: 'Residencial Vista Verde', endereco: 'Rua Cardeal Arcoverde, 900 — Alto de Pinheiros, São Paulo/SP', monitoramento_ativo: false });
  await Database.createReservatorio({ condominio_id: vistaVerde.id, nome_interno: 'Cisterna Única', nome_sensorlog: 'Vista Verde - Cisterna', tipo: 'cisterna', capacidade_litros: 25000 });
  await Database.createContato({ condominio_id: vistaVerde.id, papel: 'zelador', nome: 'Edson Nascimento', canal_preferencial: 'whatsapp', identificador_canal: '11993456789', nivel_escalonamento: 1 });
  // Sem equipamento e sem OS de propósito — mostra os EmptyState de Equipamentos/Painel pra um condomínio recém-cadastrado.

  // Alerta órfão: reservatorio_id que não bate com nenhum reservatório
  // cadastrado — mostra a badge "De-para não resolvido" no Dashboard (o
  // PRD pede pra sinalizar esse caso, nunca esconder).
  await Database.createAlerta({ reservatorio_id: randomUUID(), evento: 'NIVEL_BAIXO', texto_original: 'Caixa Fundos: nível em 22%.', classificado_por: 'regra' });

  console.log('Seed de demonstração concluído:');
  console.log('- 5 condomínios (4 monitorados, 1 sem monitoramento)');
  console.log('- 2 técnicos nomeados (carlos.mendes / roberto.silva, senha: demo123)');
  console.log('- 1 síndica (marisa.sindica / sindica123)');
  console.log('- 11 OS: abertas, em andamento, finalizadas (2 com fotos+assinaturas+PDF), 1 cancelada');
  console.log('- 7 alertas, incluindo 1 com de-para não resolvido (de propósito)');
}

main().catch((e) => {
  console.error('Erro no seed de demonstração:', e);
  process.exit(1);
});
