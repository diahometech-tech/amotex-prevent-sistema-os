import fs from 'fs';
import path from 'path';
import { demoSeed } from './seed';
import { hashPassword } from './auth';

// Tipos base para o Dossiê
export interface Dossier {
  id: string;
  client_name: string;
  cpf: string;
  phone: string;
  email: string;
  address?: string;
  gov_level: 'ouro' | 'prata';
  gov_login?: string;
  gov_password_encrypted?: string;
  status: 'captado' | 't1_pendente' | 't1_verde' | 't1_vermelho' | 't2_pendente' | 't3_bird_id' | 't3_abertura' | 't4_a1' | 'finalizado' | 'cancelado';
  current_step: 'captacao' | 't1' | 't2' | 't3' | 't4' | 'finalizado';
  photo_doc_frente_url?: string;
  photo_doc_verso_url?: string;
  photo_doc_completo_url?: string;
  photo_cnh_url?: string;
  comprovante_endereco_url?: string; // campo legado — não usado no fluxo atual
  antecedentes_url?: string; // campo legado — não usado no fluxo atual
  photo_selfie_url?: string;
  photo_selfie_rg_url?: string;
  video_prova_url?: string;
  certificado_a1_url?: string;
  // Nome original do arquivo como foi anexado (10/08/2026, pedido real: o
  // download aparecia com o nome interno do campo, "certificado_a1_url",
  // em vez de algo reconhecível). Capturado automaticamente no upload
  // (api/dossiers/[id]/upload/route.ts, body.original_name) — não é
  // digitado manualmente como os `doc_extra_N_nome`. Usado como fallback
  // de nome de download quando `empresa_nome` ainda não existe (ver
  // certificadoA1FileName em src/lib/text.ts).
  certificado_a1_nome?: string;
  documento_b_url?: string;
  cnpj_comprovante_url?: string;
  inscricao_municipal_url?: string;
  inscricao_estadual_url?: string;
  opcao_simples_url?: string;
  certidao_inteiro_teor_url?: string;
  // Anexos avulsos — 3 slots livres pra documentos que não se encaixam nos
  // campos fixos acima (cada um tem um nome digitado por quem anexa, pra
  // ficar identificável depois no dossiê; sem isso um anexo genérico não diz
  // o que é).
  doc_extra_1_url?: string;
  doc_extra_1_nome?: string;
  doc_extra_2_url?: string;
  doc_extra_2_nome?: string;
  doc_extra_3_url?: string;
  doc_extra_3_nome?: string;
  cnpj_number?: string;
  protocolo?: string; // identificador oficial gerado na finalização (vínculo ecommerce)
  empresa_aberta: boolean;
  empresa_aberta_em?: string; // timestamp de quando empresa_aberta virou true (portal do terceiro mostra essa data)
  // Marcado pelo terceiro quando ele já baixou/conferiu os documentos finais
  // da empresa aberta — não afeta o fluxo interno, é só um "check" pro
  // próprio controle dele (pra saber o que já processou vs o que é novo).
  terceiro_docs_baixados?: boolean;
  terceiro_docs_baixados_em?: string;
  t2_new_email?: string;
  // Senha do e-mail da empresa (t2_new_email) — cadastrada pelo terceiro
  // (dono do vínculo) ou por gestor/admin; revelação auditada, acessível a
  // gestor/admin, operador_certificacao e terceiro.
  t2_new_email_senha_encrypted?: string;
  t2_new_phone?: string;
  t1_justification?: string;
  assigned_to?: string;
  captured_by?: string;
  // Atestação obrigatória do captador: confirma que desativou a verificação
  // em duas etapas do gov.br do cliente (necessário p/ a equipe de certificação acessar).
  gov_2fa_disabled?: boolean;
  // Responsáveis pela etapa T3/T4 (certificação ≠ abertura)
  resp_certificacao?: string;
  resp_abertura?: string;
  // Parceiro de e-commerce ("terceiro") que assumiu o vínculo desta OS —
  // primeiro terceiro que grava dados fica dono; isola visibilidade entre
  // múltiplas contas terceiro (não quebra o caso de conta única atual).
  terceiro_responsavel?: string;
  // Contador responsável pela abertura da empresa (João/Kely/Arnaldo — definido pelo gestor)
  contador_abertura?: string;
  // Sub-etapas de certificação/abertura
  bird_id_done?: boolean;
  abertura_done?: boolean;
  a1_done?: boolean;
  // Certificações são DISTINTAS e cobradas individualmente — registra quando e
  // quem concluiu cada uma (base de conferência p/ gestor e certificador).
  bird_id_done_em?: string;
  bird_id_done_por?: string;
  a1_done_em?: string;
  a1_done_por?: string;
  // Abertura da empresa também precisa registrar quem concluiu — sem isso não
  // havia indicador de qual operador de abertura fez o processo (só sumia
  // atrás do badge "✓ concluído", sem nome).
  abertura_done_em?: string;
  abertura_done_por?: string;
  // Pagamento — 3 marcadores independentes (pedido do gestor: BIRD e A1 são
  // certificados distintos com custo próprio; o colaborador que executou é
  // pago à parte). Só gestor/admin gravam. Funciona retroativamente (inclusive
  // em OS já finalizada) — é só controle, não bloqueia nada do fluxo.
  bird_pago?: boolean;
  bird_pago_em?: string;
  bird_pago_por?: string;
  a1_pago?: boolean;
  a1_pago_em?: string;
  a1_pago_por?: string;
  colaborador_pago?: boolean;
  colaborador_pago_em?: string;
  colaborador_pago_por?: string;
  // Pagamento do captador por esta OS (pedido do gestor: tela "Captadores"
  // pra gerenciar pagamento por captação). Só gestor/admin gravam. Marcação
  // manual — não depende da OS estar finalizada, é o gestor quem decide.
  // captador_pago = "1º Pagamento" (referência: liberado na certificação do
  // BIRD, mas a marcação em si continua manual/livre pro gestor).
  captador_pago?: boolean;
  captador_pago_em?: string;
  captador_pago_por?: string;
  // Mensalidade recorrente do captador (pago do 2º mês em diante, enquanto o
  // cliente está ativo) — array JSON de competências pagas, formato "YYYY-MM"
  // (ex.: '["2026-07","2026-08"]'). Cada competência é um pagamento
  // independente; alternar usa POST com { toggle_mes_captador: 'YYYY-MM' } em
  // vez de reescrever o array inteiro do cliente (servidor calcula o diff).
  captador_pagamentos_mensais?: string;
  // Docs recusados pelo certificador — OS sai da fila dele até o captador
  // reenviar (timestamp ISO; vazio = sem recusa pendente).
  cert_docs_recusados?: string;
  bird_id_cert_url?: string;
  agendamento_cert?: string;
  // Aprovação do agendamento feito pelo captador. O slot fica RESERVADO em
  // `agendamento_cert` já na criação (senão dois captadores marcam o mesmo
  // horário), mas só vale como compromisso firme quando o certificador
  // aprova. Recusar limpa `agendamento_cert` (libera o slot) e devolve a
  // tarefa de agendar pro captador com o motivo.
  // COMPATIBILIDADE: OS antiga com `agendamento_cert` e `agendamento_status`
  // vazio conta como APROVADA — não jogar agendamento já existente pra
  // "pendente" retroativamente (ver `agendamentoAprovado` em page.tsx).
  agendamento_status?: 'pendente' | 'aprovado' | 'recusado';
  agendamento_recusa_motivo?: string;
  agendamento_decidido_por?: string;
  agendamento_decidido_em?: string;
  // Reagendamento solicitado pelo certificador — fica PENDENTE até o gestor
  // aprovar/recusar. `reagendamento_pendente` guarda o novo horário ISO proposto
  // (ou 'CANCELAR' para pedido de cancelamento); `agendamento_cert` só muda
  // quando o gestor aprova.
  reagendamento_pendente?: string;
  reagendamento_de?: string;
  reagendamento_justificativa?: string;
  reagendamento_por?: string;
  reagendamento_em?: string;
  sla_deadline?: string;
  // Dados da abertura da empresa (Ordem de Serviço - Abertura / modelo Contex)
  empresa_nome?: string;
  nome_fantasia?: string;
  // Endereço ONDE A EMPRESA SERÁ ABERTA — distinto do `address` do cliente
  // (que é o endereço pessoal, usado no BIRD ID). Preenchido no E2, editável
  // pelo gestor.
  empresa_endereco?: string;
  cnae?: string;
  capital_social?: string;
  quadro_societario?: string;
  regime_tributario?: string;
  // Classificação de porte da empresa (ME/EPP) — preenchido manualmente na
  // E3 (Abertura), mesmo bloco "Dados da Abertura" dos demais campos de
  // empresa (EmpresaAberturaFields, src/app/page.tsx). Sem auto-fill do
  // CNPJ (o retorno de publica.cnpj.ws pra esse campo não foi validado).
  porte_empresa?: string;
  // Forma de Atuação — mesmo bloco "Dados da Abertura", múltipla escolha
  // (uma empresa pode atuar de mais de uma forma ao mesmo tempo). Lista
  // separada por vírgula, mesmo formato de string usado em
  // gestor_projetos/terceiro_projeto (src/lib/gestor-scope.ts).
  forma_atuacao?: string;
  gov_socios?: string;
  forma_pagamento?: string;
  codigo_acesso?: string;
  // Checklist operacional da abertura
  cad_junta?: boolean;
  cad_receita?: boolean;
  cad_estado?: boolean;
  cad_prefeitura?: boolean;
  planilha_mensalidade?: boolean;
  planilha_simples?: boolean;
  envio_tfe?: boolean;
  opcao_simples?: boolean;
  criar_pasta_rede?: boolean;
  // Dados de acesso à certificação (BIRD ID / A1) — centralizados pra não
  // depender de planilha paralela do certificador.
  cert_certificadora?: string;
  cert_sistema_usado?: string;
  cert_aparelho?: string;
  cert_email?: string;
  cert_email_senha_encrypted?: string;
  cert_senha_acesso_encrypted?: string;
  // Classificação do projeto ao qual a empresa foi alocada — controle da
  // CONTEX (gestor/admin definem, obrigatório antes de aprovar a E1). É o
  // campo usado pra capacidade/contador de lote e pro isolamento de
  // visibilidade do terceiro (User.terceiro_projeto). NÃO confundir com
  // projeto_parceiro abaixo.
  projeto?: string;
  // Projeto/lote que o PRÓPRIO parceiro terceiro atribui à empresa — controle
  // interno DELE, sem nenhum efeito em capacidade, contador_abertura ou
  // isolamento de visibilidade (03/08/2026, esclarecimento do gestor: o
  // campo `projeto` acima e este são conceitos diferentes — antes o
  // terceiro escrevia direto em `projeto`, o que colidia com a classificação
  // da Contex).
  projeto_parceiro?: string;
  // Anotação de colaboração deixada pelo gestor/admin — visível para toda a equipe.
  gestor_note?: string;
  // Flags computadas pela rota GET (não persistidas) — indicam se há senha
  // cadastrada sem expor o valor criptografado ao client.
  has_gov_password?: boolean;
  has_cert_email_senha?: boolean;
  has_cert_senha_acesso?: boolean;
  has_t2_new_email_senha?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ActivityLog {
  id: string;
  dossier_id: string;
  user_id?: string;
  user_name: string;
  action_type: string;
  details: string;
  // IP de origem da requisição que gerou o evento (x-forwarded-for, atrás do
  // Cloudflare Tunnel). Só existe em eventos gravados a partir da introdução
  // desse campo — não é retroativo em logs antigos.
  ip_address?: string;
  created_at: string;
}

// Log de sessão (login/logout) — independente do ActivityLog por dossiê.
// Existe pra responder "quem acessou o sistema, quando e de que IP",
// sem precisar abrir OS por OS.
export interface SessionLog {
  id: string;
  user_name: string;
  role: UserRole;
  action: 'login' | 'logout';
  ip_address?: string;
  created_at: string;
}

export interface OsTask {
  id: string;
  dossier_id: string;
  from_user: string;
  to_user: string;
  text: string;
  done: boolean;
  done_by?: string;
  created_at: string;
  done_at?: string;
}

// Inscrição de push (Web Push API) — um usuário pode ter mais de uma (vários
// dispositivos/navegadores). endpoint é a chave natural de cada inscrição.
export interface PushSubscription {
  id: string;
  user_name: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export type UserRole =
  | 'captador'
  | 'operador_certificacao'
  | 'operador_abertura'
  | 'gestor'
  | 'admin'
  | 'terceiro'
  // Acesso restrito e dedicado do certificador só ao Modo Consulta
  // (/consulta) — nunca vê a esteira/kanban interno, é isolado como um
  // papel "de campo" (ver `isFieldRole` em src/lib/auth.ts), igual
  // captador/terceiro. Diferente de `operador_certificacao`, que continua
  // com acesso ao dashboard completo (agenda, tarefas, Certificação etc.).
  | 'certificador';

export interface User {
  id: string;
  name: string;
  username: string;
  password: string; // hash bcrypt (legado local pode conter texto puro; é migrado no login)
  role: UserRole;
  active: boolean;
  created_at: string;
  // Escopo de projeto(s) — só usado no papel 'terceiro'. Isolamento entre
  // parceiros de e-commerce de projetos diferentes: se preenchido, a conta
  // SÓ enxerga/edita OS's com d.projeto num desses nomes (mesmo as ainda
  // sem terceiro_responsavel definido); OS's sem projeto atribuído também
  // ficam de fora (decisão de negócio: não é fila livre compartilhada entre
  // projetos diferentes). Lista de nomes separados por vírgula (10/08/2026,
  // ampliado de "um projeto só" pra vários — mesmo pedido real de negócio
  // já atendido pra 'gestor' logo abaixo; ambos compartilham o parsing e a
  // comparação em src/lib/gestor-scope.ts). Vazio/undefined = comportamento
  // antigo, sem restrição por projeto (mantém compatibilidade com a conta
  // 'terceiro' padrão, que continua vendo tudo).
  terceiro_projeto?: string;
  // Escopo de projeto(s) — só usado no papel 'gestor' (10/08/2026, caso real:
  // conta "Gestor empresas" via OS de outro gestor/projeto que não eram
  // dela). Lista de nomes de projeto separados por vírgula (um gestor pode
  // responder por mais de um projeto/cliente ao mesmo tempo — mesmo formato
  // de terceiro_projeto, que passou a aceitar vários também). Se preenchido,
  // a conta SÓ enxerga/edita OS's com d.projeto num desses nomes — mesma
  // regra de terceiro_projeto (inclusive exclui OS's sem projeto atribuído).
  // Vazio/undefined = sem restrição (mantém compatibilidade — nenhuma conta
  // 'gestor' existente perde acesso por não ter esse campo definido).
  gestor_projetos?: string;
}

// Interface comum dos backends de persistência (JSON local / PostgreSQL).
export interface DbBackend {
  getDossiers(): Promise<Dossier[]>;
  getDossierById(id: string): Promise<Dossier | null>;
  insertDossier(d: Dossier): Promise<void>;
  updateDossier(id: string, updates: Partial<Dossier>): Promise<Dossier | null>;
  deleteDossier(id: string): Promise<boolean>;
  getDeletedDossiers(): Promise<Dossier[]>;
  restoreDossier(id: string): Promise<boolean>;
  getLogs(): Promise<ActivityLog[]>;
  getLogsByDossier(dossierId: string): Promise<ActivityLog[]>;
  insertLog(log: ActivityLog): Promise<void>;
  getSessionLogs(): Promise<SessionLog[]>;
  insertSessionLog(log: SessionLog): Promise<void>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  insertUser(u: User): Promise<void>;
  updateUser(id: string, updates: Partial<User>): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;
  // Tarefas internas por OS
  getTasksByDossier(dossierId: string): Promise<OsTask[]>;
  getTasksForUser(userName: string): Promise<(OsTask & { client_name?: string })[]>;
  insertTask(task: OsTask): Promise<void>;
  completeTask(id: string, doneBy: string, doneAt: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  // Inscrições de push (Web Push)
  getPushSubscriptionsByUser(userName: string): Promise<PushSubscription[]>;
  insertPushSubscription(sub: PushSubscription): Promise<void>;
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<void>;
}

export function shortId(len = 7): string {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

// Usuários padrão (um por hierarquia) — facilita demonstrar o RBAC de imediato.
// Em produção: trocar as senhas após o primeiro login (ou criar novos e desativar).
export function defaultUsers(): User[] {
  const now = new Date().toISOString();
  const mk = (name: string, username: string, password: string, role: UserRole): User => ({
    id: shortId(),
    name, username, password: hashPassword(password), role, active: true, created_at: now,
  });
  return [
    mk('Administrador', 'admin', 'admin123', 'admin'),
    mk('Carlos Gestor', 'gestor', 'gestor123', 'gestor'),
    mk('Mateus (Captador)', 'captador', 'cap123', 'captador'),
    mk('Resp. Certificação', 'certificacao', 'cert123', 'operador_certificacao'),
    mk('Resp. Abertura', 'abertura', 'abe123', 'operador_abertura'),
    mk('Parceiro E-commerce', 'terceiro', 'terc123', 'terceiro'),
  ];
}

// =====================================================================
// Backend JSON local (dev / custo zero)
// =====================================================================

const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'lib', 'local_db.json');

// Em desenvolvimento, popula automaticamente o banco com dados de demonstração
// quando ele está vazio. Em produção isto nunca acontece.
const AUTOSEED = process.env.NODE_ENV !== 'production' && process.env.NEXUSFLOW_NO_SEED !== '1';
let seededThisProcess = false;

function initLocalDB() {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const initialData = AUTOSEED ? demoSeed() : { dossiers: [], logs: [] };
    fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

function readLocalDB() {
  initLocalDB();
  try {
    const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
    const data = JSON.parse(raw);

    // Seed de fallback: se o arquivo existe mas está vazio (ex.: criado por outra
    // instância antes do seed), popula uma única vez por processo em dev.
    if (AUTOSEED && !seededThisProcess && (!data.dossiers || data.dossiers.length === 0)) {
      seededThisProcess = true;
      const seeded = { ...demoSeed(), users: defaultUsers() };
      writeLocalDB(seeded);
      return seeded;
    }

    // Garante a existência dos usuários padrão em bancos criados antes do RBAC.
    if (!data.users || data.users.length === 0) {
      data.users = defaultUsers();
      writeLocalDB(data);
    }
    return data;
  } catch (e) {
    console.error('Erro ao ler DB local:', e);
    return { dossiers: [], logs: [] };
  }
}

function writeLocalDB(data: any) {
  initLocalDB();
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao gravar DB local:', e);
  }
}

const jsonBackend: DbBackend = {
  async getDossiers() { return readLocalDB().dossiers.filter((d: Dossier) => !d.deleted_at); },
  async getDossierById(id) {
    const d = readLocalDB().dossiers.find((d: Dossier) => d.id === id);
    return (d && !d.deleted_at) ? d : null;
  },
  async insertDossier(d) {
    const db = readLocalDB();
    db.dossiers.push(d);
    writeLocalDB(db);
  },
  async updateDossier(id, updates) {
    const db = readLocalDB();
    const index = db.dossiers.findIndex((d: Dossier) => d.id === id);
    if (index === -1) return null;
    const updated = { ...db.dossiers[index], ...updates, updated_at: new Date().toISOString() };
    db.dossiers[index] = updated;
    writeLocalDB(db);
    return updated;
  },
  async deleteDossier(id) {
    const db = readLocalDB();
    const idx = db.dossiers.findIndex((d: Dossier) => d.id === id && !d.deleted_at);
    if (idx === -1) return false;
    db.dossiers[idx] = { ...db.dossiers[idx], deleted_at: new Date().toISOString() };
    writeLocalDB(db);
    return true;
  },
  async getDeletedDossiers() {
    return readLocalDB().dossiers.filter((d: Dossier) => !!d.deleted_at);
  },
  async restoreDossier(id) {
    const db = readLocalDB();
    const idx = db.dossiers.findIndex((d: Dossier) => d.id === id && !!d.deleted_at);
    if (idx === -1) return false;
    db.dossiers[idx] = { ...db.dossiers[idx], deleted_at: undefined };
    writeLocalDB(db);
    return true;
  },
  async getLogs() { return readLocalDB().logs; },
  async getLogsByDossier(dossierId) {
    return readLocalDB().logs.filter((l: ActivityLog) => l.dossier_id === dossierId);
  },
  async insertLog(log) {
    const db = readLocalDB();
    db.logs.unshift(log); // Logs mais novos primeiro
    writeLocalDB(db);
  },
  async getSessionLogs() { return readLocalDB().session_logs || []; },
  async insertSessionLog(log) {
    const db = readLocalDB();
    db.session_logs = db.session_logs || [];
    db.session_logs.unshift(log); // Mais recentes primeiro
    writeLocalDB(db);
  },
  async getUsers() { return readLocalDB().users || []; },
  async getUserByUsername(username) {
    const u = (readLocalDB().users || []).find(
      (x: User) => x.username.toLowerCase() === String(username).toLowerCase()
    );
    return u || null;
  },
  async getUserById(id) {
    return (readLocalDB().users || []).find((x: User) => x.id === id) || null;
  },
  async insertUser(u) {
    const db = readLocalDB();
    if (!db.users) db.users = [];
    db.users.push(u);
    writeLocalDB(db);
  },
  async updateUser(id, updates) {
    const db = readLocalDB();
    if (!db.users) db.users = [];
    const i = db.users.findIndex((x: User) => x.id === id);
    if (i === -1) return null;
    db.users[i] = { ...db.users[i], ...updates };
    writeLocalDB(db);
    return db.users[i];
  },
  async deleteUser(id) {
    const db = readLocalDB();
    if (!db.users) db.users = [];
    const before = db.users.length;
    db.users = db.users.filter((x: User) => x.id !== id);
    const removed = db.users.length < before;
    if (removed) writeLocalDB(db);
    return removed;
  },
  async getTasksByDossier(dossierId) {
    const db = readLocalDB();
    return (db.tasks || []).filter((t: OsTask) => t.dossier_id === dossierId);
  },
  async getTasksForUser(userName) {
    const db = readLocalDB();
    const tasks = (db.tasks || []).filter((t: OsTask) => t.to_user === userName);
    return tasks.map((t: OsTask) => {
      const dos = (db.dossiers || []).find((d: Dossier) => d.id === t.dossier_id);
      return { ...t, client_name: dos?.client_name };
    });
  },
  async insertTask(task) {
    const db = readLocalDB();
    if (!db.tasks) db.tasks = [];
    db.tasks.unshift(task);
    writeLocalDB(db);
  },
  async completeTask(id, doneBy, doneAt) {
    const db = readLocalDB();
    if (!db.tasks) db.tasks = [];
    const i = db.tasks.findIndex((t: OsTask) => t.id === id);
    if (i !== -1) { db.tasks[i] = { ...db.tasks[i], done: true, done_by: doneBy, done_at: doneAt }; writeLocalDB(db); }
  },
  async deleteTask(id) {
    const db = readLocalDB();
    if (!db.tasks) return;
    db.tasks = db.tasks.filter((t: OsTask) => t.id !== id);
    writeLocalDB(db);
  },
  async getPushSubscriptionsByUser(userName) {
    const db = readLocalDB();
    return (db.push_subscriptions || []).filter((s: PushSubscription) => s.user_name === userName);
  },
  async insertPushSubscription(sub) {
    const db = readLocalDB();
    db.push_subscriptions = db.push_subscriptions || [];
    // Mesmo endpoint reinscrevendo (ex.: token renovado) substitui a entrada antiga.
    db.push_subscriptions = db.push_subscriptions.filter((s: PushSubscription) => s.endpoint !== sub.endpoint);
    db.push_subscriptions.push(sub);
    writeLocalDB(db);
  },
  async deletePushSubscriptionByEndpoint(endpoint) {
    const db = readLocalDB();
    db.push_subscriptions = (db.push_subscriptions || []).filter((s: PushSubscription) => s.endpoint !== endpoint);
    writeLocalDB(db);
  },
};

// =====================================================================
// Seleção do backend: PostgreSQL quando DATABASE_URL está definido.
// =====================================================================

let backendInstance: DbBackend | null = null;

function backend(): DbBackend {
  if (backendInstance) return backendInstance;
  if (process.env.DATABASE_URL) {
    // Import dinâmico via require p/ não carregar o driver quando não usado.
    const { pgBackend } = require('./db-postgres') as typeof import('./db-postgres');
    backendInstance = pgBackend;
  } else {
    backendInstance = jsonBackend;
  }
  return backendInstance;
}

// Adaptador Geral de Banco de Dados (regras de negócio independem do backend)
export class Database {
  // Retorna todos os dossiês
  static async getDossiers(): Promise<Dossier[]> {
    return backend().getDossiers();
  }

  // Busca dossiê específico
  static async getDossierById(id: string): Promise<Dossier | null> {
    return backend().getDossierById(id);
  }

  // Cria um novo dossiê
  static async createDossier(data: Partial<Dossier>): Promise<Dossier> {
    // TODA captação entra na esteira em "Captados" (caixa de entrada).
    // A verificação de risco (T1) acontece para TODOS antes de prosseguir —
    // independentemente do nível Gov (Ouro/Prata). A bifurcação Ouro/Prata
    // ocorre só depois (na decisão T1 / no T2).
    const dossier: Dossier = {
      id: shortId(), // Id de OS curto e amigável para MVP
      client_name: data.client_name || '',
      cpf: data.cpf || '',
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      gov_level: data.gov_level || 'prata',
      gov_login: data.gov_login || data.cpf || '',
      gov_password_encrypted: data.gov_password_encrypted || '',
      captured_by: data.captured_by || 'Captador não identificado',
      empresa_aberta: false,
      photo_doc_frente_url: data.photo_doc_frente_url || '',
      photo_doc_verso_url: data.photo_doc_verso_url || '',
      sla_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 horas de SLA padrão
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...data,
      // Estágio inicial fixo (sobrepõe qualquer valor vindo em `data`).
      status: 'captado',
      current_step: 'captacao',
    } as Dossier;

    await backend().insertDossier(dossier);

    // Grava log de criação
    await this.createLog({
      dossier_id: dossier.id,
      user_name: dossier.captured_by || 'Sistema NexusFlow',
      action_type: 'OS_CREATED',
      details: `Captação registrada por ${dossier.captured_by}. Nível Gov: ${dossier.gov_level.toUpperCase()}. Aguardando triagem para análise de risco (T1).`,
    });

    return dossier;
  }

  // Atualiza um dossiê existente
  static async updateDossier(id: string, updates: Partial<Dossier>): Promise<Dossier | null> {
    return backend().updateDossier(id, updates);
  }

  // Próximo protocolo sequencial no padrão A560, A561, ... (mínimo A560).
  // É o mesmo identificador usado no celular do e-commerce — por isso NUNCA
  // pode se repetir. Inclui os dossiês excluídos (lixeira) no cálculo: um
  // protocolo já atribuído a uma OS que depois foi excluída não pode ser
  // "esquecido" e reutilizado (já causou colisão real em produção — várias
  // OS finalizadas saíram todas com o mesmo protocolo porque as OS de teste
  // que tinham usado os números anteriores foram para a lixeira).
  static async getNextProtocolo(): Promise<string> {
    const [ativos, excluidos] = await Promise.all([
      backend().getDossiers(),
      backend().getDeletedDossiers(),
    ]);
    let maxN = 559; // próximo será 560
    for (const d of [...ativos, ...excluidos]) {
      const m = (d.protocolo || '').match(/^A(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    return `A${maxN + 1}`;
  }

  // Remove um dossiê e seus logs associados.
  static async deleteDossier(id: string): Promise<boolean> {
    return backend().deleteDossier(id);
  }

  // Lista dossiês excluídos (soft-delete) — usado pela Lixeira do gestor/admin.
  static async getDeletedDossiers(): Promise<Dossier[]> {
    return backend().getDeletedDossiers();
  }

  // Restaura um dossiê excluído (limpa deleted_at).
  static async restoreDossier(id: string): Promise<boolean> {
    return backend().restoreDossier(id);
  }

  // Retorna todos os logs de auditoria
  static async getLogs(): Promise<ActivityLog[]> {
    return backend().getLogs();
  }

  // Retorna logs de uma OS específica
  static async getLogsByDossier(dossierId: string): Promise<ActivityLog[]> {
    return backend().getLogsByDossier(dossierId);
  }

  // Cria um log de auditoria
  static async createLog(logData: Partial<ActivityLog>): Promise<ActivityLog> {
    const log: ActivityLog = {
      id: shortId(9),
      dossier_id: logData.dossier_id || '',
      user_id: logData.user_id,
      user_name: logData.user_name || 'Operador',
      action_type: logData.action_type || 'SYSTEM_ACTION',
      details: logData.details || '',
      ip_address: logData.ip_address,
      created_at: new Date().toISOString()
    };
    await backend().insertLog(log);
    return log;
  }

  // Retorna o log de sessões (login/logout) — base do "Log de Acessos".
  static async getSessionLogs(): Promise<SessionLog[]> {
    return backend().getSessionLogs();
  }

  // Registra um evento de sessão (login/logout) com IP de origem.
  static async createSessionLog(data: Partial<SessionLog>): Promise<SessionLog> {
    const log: SessionLog = {
      id: shortId(9),
      user_name: data.user_name || 'Desconhecido',
      role: data.role || 'captador',
      action: data.action || 'login',
      ip_address: data.ip_address,
      created_at: new Date().toISOString(),
    };
    await backend().insertSessionLog(log);
    return log;
  }

  // ===== Usuários (RBAC) =====

  static async getUsers(): Promise<User[]> {
    return backend().getUsers();
  }

  static async getUserByUsername(username: string): Promise<User | null> {
    return backend().getUserByUsername(username);
  }

  static async getUserById(id: string): Promise<User | null> {
    return backend().getUserById(id);
  }

  static async createUser(data: Partial<User>): Promise<User> {
    const user: User = {
      id: shortId(),
      name: data.name || '',
      username: (data.username || '').toLowerCase(),
      // Senha SEMPRE armazenada com hash bcrypt.
      password: data.password ? hashPassword(data.password) : '',
      role: (data.role as UserRole) || 'captador',
      active: data.active !== false,
      created_at: new Date().toISOString(),
      ...(data.terceiro_projeto ? { terceiro_projeto: data.terceiro_projeto } : {}),
      ...(data.gestor_projetos ? { gestor_projetos: data.gestor_projetos } : {}),
    };
    await backend().insertUser(user);
    return user;
  }

  static async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    return backend().updateUser(id, updates);
  }

  static async deleteUser(id: string): Promise<boolean> {
    return backend().deleteUser(id);
  }

  static async getUsersByRole(role: UserRole): Promise<User[]> {
    const users = await backend().getUsers();
    return users.filter(u => u.role === role && u.active);
  }

  // ===== Tarefas internas por OS =====

  static async getTasksByDossier(dossierId: string): Promise<OsTask[]> {
    return backend().getTasksByDossier(dossierId);
  }

  static async getTasksForUser(userName: string): Promise<(OsTask & { client_name?: string })[]> {
    return backend().getTasksForUser(userName);
  }

  static async insertTask(task: OsTask): Promise<void> {
    return backend().insertTask(task);
  }

  static async completeTask(id: string, doneBy: string, doneAt: string): Promise<void> {
    return backend().completeTask(id, doneBy, doneAt);
  }

  static async deleteTask(id: string): Promise<void> {
    return backend().deleteTask(id);
  }

  // ===== Inscrições de push (Web Push) =====

  static async getPushSubscriptionsByUser(userName: string): Promise<PushSubscription[]> {
    return backend().getPushSubscriptionsByUser(userName);
  }

  static async insertPushSubscription(sub: PushSubscription): Promise<void> {
    return backend().insertPushSubscription(sub);
  }

  static async deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
    return backend().deletePushSubscriptionByEndpoint(endpoint);
  }
}
