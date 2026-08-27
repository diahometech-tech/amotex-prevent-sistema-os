// Dados de exemplo para dev/teste local — 2 condomínios cobrindo os casos
// que a UI e as regras de negócio precisam exercitar: reservatórios com
// de-para SensorLog, cadeia de escalonamento por níveis, síndico restrito
// ao próprio condomínio, e OS em diferentes status/tipo/prioridade
// (incluindo uma com checklist incompleto, pra testar a trava de
// finalização em Database.finalizarOS).
//
// Roda contra o backend JSON local por padrão. Com DATABASE_URL definido
// no ambiente, roda contra o Postgres apontado (mesma interface DbBackend).
//
// Uso: npm run seed

import { Database } from '../src/lib/db';

async function main() {
  // Trava contra rodar em produção sem querer: com DATABASE_URL definido o
  // Database escreve no Postgres real (a VPS tem essa variável no ambiente do
  // container), e este seed cria condomínios fictícios e uma usuária de teste
  // com senha conhecida. Só passa com --force explícito.
  if (process.env.DATABASE_URL && !process.argv.includes('--force')) {
    console.error(
      'RECUSADO: DATABASE_URL está definido — este seed gravaria dados fictícios ' +
      'num banco Postgres real (inclui usuária de teste com senha conhecida).\n' +
      'Se é mesmo o que você quer, rode: npm run seed -- --force'
    );
    process.exit(1);
  }

  console.log('Seed iniciado (backend: ' + (process.env.DATABASE_URL ? 'Postgres' : 'JSON local') + ')');

  // ----- Condomínio 1: Residencial Jardim das Flores -----
  const jardim = await Database.createCondominio({
    nome: 'Residencial Jardim das Flores',
    endereco: 'Rua das Acácias, 245 — Vila Mariana, São Paulo/SP',
    administradora: 'Administradora Silva & Cia',
    monitoramento_ativo: true,
  });

  const jardimTorre = await Database.createReservatorio({
    condominio_id: jardim.id,
    nome_interno: 'Caixa Torre 01',
    nome_sensorlog: 'Caixa torre 03',
    tipo: 'torre',
    capacidade_litros: 15000,
  });
  await Database.createReservatorio({
    condominio_id: jardim.id,
    nome_interno: 'Cisterna Térreo',
    nome_sensorlog: 'Cisterna Jardim Flores',
    tipo: 'cisterna',
    capacidade_litros: 30000,
  });

  await Database.createContato({
    condominio_id: jardim.id, papel: 'zelador', nome: 'Seu Antônio',
    canal_preferencial: 'whatsapp', identificador_canal: '11987654321', nivel_escalonamento: 1,
  });
  await Database.createContato({
    condominio_id: jardim.id, papel: 'sindico', nome: 'Marisa Oliveira',
    canal_preferencial: 'whatsapp', identificador_canal: '11976543210', nivel_escalonamento: 2,
  });
  await Database.createContato({
    condominio_id: jardim.id, papel: 'conservadora', nome: 'Amotex — Plantão',
    canal_preferencial: 'telegram', identificador_canal: '@amotex_plantao', nivel_escalonamento: 3,
  });

  const bombaJardim = await Database.createEquipamento({
    condominio_id: jardim.id, tipo: 'Bomba d\'água', modelo: 'Schneider BC-92 1CV', potencia_hp: 1,
  });
  await Database.createEquipamento({
    condominio_id: jardim.id, tipo: 'Boia elétrica', modelo: 'Fluir Boia Náutica',
  });

  // Usuária síndica escopada ao Jardim das Flores — pra testar canAccessCondominio.
  await Database.createUser({
    nome: 'Marisa Oliveira', login: 'marisa.sindica', senha: 'sindica123',
    papel: 'sindico', condominio_id: jardim.id,
  });

  // OS corretiva em aberto, checklist incompleto — exercita a trava de
  // finalizarOS (não deve finalizar com item obrigatório pendente).
  const osCorretiva = await Database.createOS({
    condominio_id: jardim.id, tipo: 'corretiva', origem: 'manual',
    observacao: 'Bomba não está ligando desde ontem à noite — zelador reportou por WhatsApp.',
  });
  await Database.createChecklistItem({ os_id: osCorretiva.id, equipamento_id: bombaJardim.id, descricao: 'Verificar alimentação elétrica da bomba', obrigatorio: true });
  await Database.createChecklistItem({ os_id: osCorretiva.id, equipamento_id: bombaJardim.id, descricao: 'Testar capacitor de partida', obrigatorio: true });
  const itemConcluidoJardim = (await Database.getChecklistByOS(osCorretiva.id))[0];
  await Database.concluirChecklistItem(itemConcluidoJardim.id);

  // OS preventiva finalizada — histórico de rota já concluída.
  const osPreventivaFinalizada = await Database.createOS({
    condominio_id: jardim.id, tipo: 'preventiva', origem: 'manual', prioridade: 'baixa',
    observacao: 'Visita mensal de rotina.',
  });
  const itemPrevJardim = await Database.createChecklistItem({ os_id: osPreventivaFinalizada.id, descricao: 'Inspeção visual geral dos reservatórios', obrigatorio: true });
  await Database.concluirChecklistItem(itemPrevJardim.id);
  await Database.finalizarOS(osPreventivaFinalizada.id, {});

  // OS automática do Hermes (simula o fluxo de alerta -> OS) — condomínio recém-avisado.
  const alertaJardim = await Database.createAlerta({
    reservatorio_id: jardimTorre.id, evento: 'NIVEL_MUITO_BAIXO',
    texto_original: '⚠️ Caixa torre 03: nível em 8% — risco de desabastecimento em ~2h.',
    classificado_por: 'regra',
  });
  await Database.createOS({
    condominio_id: jardim.id, tipo: 'corretiva', origem: 'hermes_automatica', alerta_id: alertaJardim.id, prioridade: 'alta',
    observacao: 'OS aberta automaticamente pelo Hermes — nível muito baixo sem confirmação de ACK em 15min.',
  });

  // ----- Condomínio 2: Edifício Bela Vista -----
  const belaVista = await Database.createCondominio({
    nome: 'Edifício Bela Vista',
    endereco: 'Av. Paulista, 1800 — Bela Vista, São Paulo/SP',
    monitoramento_ativo: true,
  });

  const belaVistaCisterna = await Database.createReservatorio({
    condominio_id: belaVista.id, nome_interno: 'Cisterna Subsolo',
    nome_sensorlog: 'Bela Vista - Cisterna', tipo: 'cisterna', capacidade_litros: 50000,
  });
  await Database.createReservatorio({
    condominio_id: belaVista.id, nome_interno: 'Caixa Superior',
    nome_sensorlog: 'Bela Vista - Superior', tipo: 'superior', capacidade_litros: 20000,
  });

  await Database.createContato({
    condominio_id: belaVista.id, papel: 'zelador', nome: 'João Batista',
    canal_preferencial: 'telegram', identificador_canal: '@joaobatista_zelador', nivel_escalonamento: 1,
  });
  await Database.createContato({
    condominio_id: belaVista.id, papel: 'administradora', nome: 'Gestão Predial Bela Vista',
    canal_preferencial: 'email', identificador_canal: 'contato@gestaobelavista.com.br', nivel_escalonamento: 2,
  });

  const bombaBelaVista = await Database.createEquipamento({
    condominio_id: belaVista.id, tipo: 'Bomba d\'água', modelo: 'Grundfos CR-3 2CV', potencia_hp: 2,
  });

  // OS em andamento — técnico já em campo, checklist parcialmente feito.
  const osEmAndamento = await Database.createOS({
    condominio_id: belaVista.id, tipo: 'preventiva', origem: 'manual', prioridade: 'media',
  });
  await Database.updateOS(osEmAndamento.id, { status: 'em_andamento', entrada_em: new Date().toISOString() });
  await Database.createChecklistItem({ os_id: osEmAndamento.id, equipamento_id: bombaBelaVista.id, descricao: 'Verificar ruído e vibração da bomba', obrigatorio: true });
  await Database.createChecklistItem({ os_id: osEmAndamento.id, descricao: 'Registrar nível dos reservatórios', obrigatorio: false });

  // Alerta de sensor mudo, ainda sem OS — cenário de SEM_REPORTE aguardando triagem.
  await Database.createAlerta({
    reservatorio_id: belaVistaCisterna.id, evento: 'SEM_REPORTE',
    classificado_por: 'regra',
  });

  console.log('Seed concluído:');
  console.log(`- 2 condomínios (${jardim.nome}, ${belaVista.nome})`);
  console.log('- 4 reservatórios, 5 contatos, 3 equipamentos');
  console.log('- 1 usuária síndica (login: marisa.sindica / senha: sindica123)');
  console.log('- 4 OS (corretiva aberta c/ checklist pendente, preventiva finalizada, automática do Hermes, em andamento)');
  console.log('- 2 alertas (nível muito baixo, sem reporte)');
}

main().catch((e) => {
  console.error('Erro no seed:', e);
  process.exit(1);
});
