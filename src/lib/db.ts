import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { hashPassword } from './auth';

// =====================================================================
// Tipos de domínio — Amotex Prevent (ver docs/Modelo-de-Dados.md no
// repositório amotex-prevent-infra para o schema completo e o porquê de
// cada entidade).
// =====================================================================

export interface Condominio {
  id: string;
  nome: string;
  endereco?: string;
  administradora?: string;
  monitoramento_ativo: boolean;
  criado_em: string;
}

// Ponto monitorado dentro de um condomínio. nome_sensorlog é a chave de
// resolução do alerta: a mensagem que chega da SensorLog referencia o
// reservatório ("Caixa torre 03"), não o condomínio diretamente.
export interface Reservatorio {
  id: string;
  condominio_id: string;
  nome_interno: string;
  nome_sensorlog: string;
  tipo: 'cisterna' | 'superior' | 'torre';
  capacidade_litros?: number;
  ultima_mensagem_recebida_em?: string;
}

// Quem é notificado, em qual canal, por condomínio. nivel_escalonamento
// fica no registro (não fixo em código) — cada condomínio pode ter sua
// própria cadeia sem alterar a aplicação.
export interface Contato {
  id: string;
  condominio_id: string;
  papel: 'zelador' | 'sindico' | 'administradora' | 'conservadora' | 'plantao';
  nome: string;
  canal_preferencial: 'telegram' | 'whatsapp' | 'email';
  identificador_canal: string;
  nivel_escalonamento: 1 | 2 | 3;
  ativo: boolean;
}

export interface Equipamento {
  id: string;
  condominio_id: string;
  tipo: string;
  modelo?: string;
  potencia_hp?: number;
  cadastrado_em: string;
}

export type UserRole = 'admin' | 'tecnico' | 'sindico';

export interface User {
  id: string;
  nome: string;
  login: string; // identificador único de acesso, distinto do nome de exibição
  papel: UserRole;
  condominio_id?: string; // só preenchido para papel = sindico
  senha_hash: string;
  ativo: boolean;
  criado_em: string;
}

export type EventoAlerta =
  | 'NIVEL_BAIXO'
  | 'NIVEL_CRITICO'
  | 'NIVEL_MUITO_BAIXO'
  | 'TENDENCIA_QUEDA_MADRUGADA'
  | 'RECUPEROU'
  | 'SEM_REPORTE';

export interface Alerta {
  id: string;
  reservatorio_id: string;
  texto_original?: string;
  evento: EventoAlerta;
  classificado_por: 'regra' | 'llm' | 'humano';
  recebido_em: string;
}

export interface Playbook {
  id: string;
  evento: EventoAlerta;
  versao: number;
  conteudo: unknown; // diagnóstico + passos + opções — ver docs/PRD-v2.md
  ativo: boolean;
  criado_em: string;
}

export interface Escalonamento {
  id: string;
  alerta_id: string;
  contato_id: string;
  nivel: number;
  canal_usado?: string;
  enviado_em: string;
  ack_em?: string;
}

export type OsTipo = 'preventiva' | 'corretiva';
export type OsOrigem = 'manual' | 'hermes_automatica';
export type OsStatus = 'aberta' | 'em_andamento' | 'finalizada' | 'cancelada';
export type OsPrioridade = 'alta' | 'media' | 'baixa';

export interface OS {
  id: string;
  condominio_id: string;
  tipo: OsTipo;
  origem: OsOrigem;
  alerta_id?: string; // só quando origem = hermes_automatica
  status: OsStatus;
  prioridade: OsPrioridade;
  tecnico_id?: string;
  entrada_em?: string;
  saida_em?: string;
  observacao?: string;
  assinatura_zelador_url?: string;
  assinatura_tecnico_url?: string;
  pdf_url?: string;
  criado_em: string;
}

export interface ChecklistItem {
  id: string;
  os_id: string;
  equipamento_id?: string;
  descricao: string;
  obrigatorio: boolean;
  concluido: boolean;
  concluido_em?: string;
}

export interface Foto {
  id: string;
  os_id: string;
  momento: 'antes' | 'depois';
  url: string;
  enviado_em: string;
}

export interface AuditLog {
  id: string;
  entidade: string;
  entidade_id?: string;
  acao: string;
  ator: string; // nome de usuário, "hermes" ou "n8n"
  detalhe?: unknown;
  criado_em: string;
}

// Log de sessão (login/logout) — independente do AuditLog por entidade.
export interface SessionLog {
  id: string;
  user_name: string;
  role: UserRole;
  action: 'login' | 'logout';
  ip_address?: string;
  created_at: string;
}

// =====================================================================
// Interface comum dos backends de persistência (JSON local / PostgreSQL)
// =====================================================================

export interface DbBackend {
  // Condomínio
  getCondominios(): Promise<Condominio[]>;
  getCondominioById(id: string): Promise<Condominio | null>;
  insertCondominio(c: Condominio): Promise<void>;
  updateCondominio(id: string, updates: Partial<Condominio>): Promise<Condominio | null>;

  // Reservatório
  getReservatoriosByCondominio(condominioId: string): Promise<Reservatorio[]>;
  getReservatorioByNomeSensorlog(nomeSensorlog: string): Promise<Reservatorio | null>;
  insertReservatorio(r: Reservatorio): Promise<void>;
  updateReservatorio(id: string, updates: Partial<Reservatorio>): Promise<Reservatorio | null>;

  // Contato
  getContatosByCondominio(condominioId: string): Promise<Contato[]>;
  getContatoNivel(condominioId: string, nivel: number): Promise<Contato | null>;
  insertContato(c: Contato): Promise<void>;
  updateContato(id: string, updates: Partial<Contato>): Promise<Contato | null>;

  // Equipamento
  getEquipamentosByCondominio(condominioId: string): Promise<Equipamento[]>;
  insertEquipamento(e: Equipamento): Promise<void>;

  // Usuário (RBAC)
  getUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | null>;
  getUserByLogin(login: string): Promise<User | null>;
  insertUser(u: User): Promise<void>;
  updateUser(id: string, updates: Partial<User>): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;

  // Alerta
  getAlertas(): Promise<Alerta[]>;
  getAlertaById(id: string): Promise<Alerta | null>;
  getAlertasByReservatorio(reservatorioId: string): Promise<Alerta[]>;
  insertAlerta(a: Alerta): Promise<void>;

  // Playbook
  getPlaybookAtivo(evento: EventoAlerta): Promise<Playbook | null>;
  getPlaybooks(): Promise<Playbook[]>;
  insertPlaybook(p: Playbook): Promise<void>;

  // Escalonamento
  getEscalonamentosByAlerta(alertaId: string): Promise<Escalonamento[]>;
  insertEscalonamento(e: Escalonamento): Promise<void>;
  registrarAck(id: string, ackEm: string): Promise<void>;

  // OS
  getOSs(): Promise<OS[]>;
  getOSById(id: string): Promise<OS | null>;
  getOSsByCondominio(condominioId: string): Promise<OS[]>;
  insertOS(os: OS): Promise<void>;
  updateOS(id: string, updates: Partial<OS>): Promise<OS | null>;

  // Checklist
  getChecklistByOS(osId: string): Promise<ChecklistItem[]>;
  insertChecklistItem(item: ChecklistItem): Promise<void>;
  updateChecklistItem(id: string, updates: Partial<ChecklistItem>): Promise<ChecklistItem | null>;

  // Foto
  getFotosByOS(osId: string): Promise<Foto[]>;
  insertFoto(f: Foto): Promise<void>;

  // Auditoria
  getAuditLogs(): Promise<AuditLog[]>;
  getAuditLogsByEntidade(entidade: string, entidadeId: string): Promise<AuditLog[]>;
  insertAuditLog(log: AuditLog): Promise<void>;
  getSessionLogs(): Promise<SessionLog[]>;
  insertSessionLog(log: SessionLog): Promise<void>;
}

export function shortId(len = 7): string {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

// Usuários padrão — trocar as senhas após o primeiro login em produção.
export function defaultUsers(): User[] {
  const now = new Date().toISOString();
  const mk = (nome: string, login: string, senha: string, papel: UserRole, condominioId?: string): User => ({
    id: randomUUID(),
    nome,
    login,
    papel,
    condominio_id: condominioId,
    senha_hash: hashPassword(senha),
    ativo: true,
    criado_em: now,
  });
  return [
    mk('Administrador', 'admin', 'admin123', 'admin'),
    mk('Técnico', 'tecnico', 'tecnico123', 'tecnico'),
  ];
}

// =====================================================================
// Backend JSON local (dev / custo zero)
// =====================================================================

const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'lib', 'local_db.json');

function emptyDB() {
  return {
    condominios: [] as Condominio[],
    reservatorios: [] as Reservatorio[],
    contatos: [] as Contato[],
    equipamentos: [] as Equipamento[],
    users: [] as User[],
    alertas: [] as Alerta[],
    playbooks: [] as Playbook[],
    escalonamentos: [] as Escalonamento[],
    oss: [] as OS[],
    checklist_items: [] as ChecklistItem[],
    fotos: [] as Foto[],
    audit_logs: [] as AuditLog[],
    session_logs: [] as SessionLog[],
  };
}

function initLocalDB() {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const initial = { ...emptyDB(), users: defaultUsers() };
    fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function readLocalDB(): ReturnType<typeof emptyDB> {
  initLocalDB();
  try {
    const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
    const data = { ...emptyDB(), ...JSON.parse(raw) };
    if (!data.users || data.users.length === 0) {
      data.users = defaultUsers();
      writeLocalDB(data);
    }
    return data;
  } catch (e) {
    console.error('Erro ao ler DB local:', e);
    return emptyDB();
  }
}

function writeLocalDB(data: ReturnType<typeof emptyDB>) {
  initLocalDB();
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao gravar DB local:', e);
  }
}

const jsonBackend: DbBackend = {
  async getCondominios() { return readLocalDB().condominios; },
  async getCondominioById(id) {
    return readLocalDB().condominios.find((c) => c.id === id) || null;
  },
  async insertCondominio(c) {
    const db = readLocalDB();
    db.condominios.push(c);
    writeLocalDB(db);
  },
  async updateCondominio(id, updates) {
    const db = readLocalDB();
    const i = db.condominios.findIndex((c) => c.id === id);
    if (i === -1) return null;
    db.condominios[i] = { ...db.condominios[i], ...updates };
    writeLocalDB(db);
    return db.condominios[i];
  },

  async getReservatoriosByCondominio(condominioId) {
    return readLocalDB().reservatorios.filter((r) => r.condominio_id === condominioId);
  },
  async getReservatorioByNomeSensorlog(nomeSensorlog) {
    return readLocalDB().reservatorios.find((r) => r.nome_sensorlog === nomeSensorlog) || null;
  },
  async insertReservatorio(r) {
    const db = readLocalDB();
    db.reservatorios.push(r);
    writeLocalDB(db);
  },
  async updateReservatorio(id, updates) {
    const db = readLocalDB();
    const i = db.reservatorios.findIndex((r) => r.id === id);
    if (i === -1) return null;
    db.reservatorios[i] = { ...db.reservatorios[i], ...updates };
    writeLocalDB(db);
    return db.reservatorios[i];
  },

  async getContatosByCondominio(condominioId) {
    return readLocalDB().contatos.filter((c) => c.condominio_id === condominioId);
  },
  async getContatoNivel(condominioId, nivel) {
    return readLocalDB().contatos.find(
      (c) => c.condominio_id === condominioId && c.nivel_escalonamento === nivel && c.ativo
    ) || null;
  },
  async insertContato(c) {
    const db = readLocalDB();
    db.contatos.push(c);
    writeLocalDB(db);
  },
  async updateContato(id, updates) {
    const db = readLocalDB();
    const i = db.contatos.findIndex((c) => c.id === id);
    if (i === -1) return null;
    db.contatos[i] = { ...db.contatos[i], ...updates };
    writeLocalDB(db);
    return db.contatos[i];
  },

  async getEquipamentosByCondominio(condominioId) {
    return readLocalDB().equipamentos.filter((e) => e.condominio_id === condominioId);
  },
  async insertEquipamento(e) {
    const db = readLocalDB();
    db.equipamentos.push(e);
    writeLocalDB(db);
  },

  async getUsers() { return readLocalDB().users; },
  async getUserById(id) {
    return readLocalDB().users.find((u) => u.id === id) || null;
  },
  async getUserByLogin(login) {
    return readLocalDB().users.find((u) => u.login.toLowerCase() === login.toLowerCase()) || null;
  },
  async insertUser(u) {
    const db = readLocalDB();
    db.users.push(u);
    writeLocalDB(db);
  },
  async updateUser(id, updates) {
    const db = readLocalDB();
    const i = db.users.findIndex((u) => u.id === id);
    if (i === -1) return null;
    db.users[i] = { ...db.users[i], ...updates };
    writeLocalDB(db);
    return db.users[i];
  },
  async deleteUser(id) {
    const db = readLocalDB();
    const before = db.users.length;
    db.users = db.users.filter((u) => u.id !== id);
    const removed = db.users.length < before;
    if (removed) writeLocalDB(db);
    return removed;
  },

  async getAlertas() { return readLocalDB().alertas; },
  async getAlertaById(id) {
    return readLocalDB().alertas.find((a) => a.id === id) || null;
  },
  async getAlertasByReservatorio(reservatorioId) {
    return readLocalDB().alertas.filter((a) => a.reservatorio_id === reservatorioId);
  },
  async insertAlerta(a) {
    const db = readLocalDB();
    db.alertas.unshift(a);
    writeLocalDB(db);
  },

  async getPlaybookAtivo(evento) {
    const playbooks = readLocalDB().playbooks.filter((p) => p.evento === evento && p.ativo);
    return playbooks.sort((a, b) => b.versao - a.versao)[0] || null;
  },
  async getPlaybooks() { return readLocalDB().playbooks; },
  async insertPlaybook(p) {
    const db = readLocalDB();
    db.playbooks.push(p);
    writeLocalDB(db);
  },

  async getEscalonamentosByAlerta(alertaId) {
    return readLocalDB().escalonamentos.filter((e) => e.alerta_id === alertaId);
  },
  async insertEscalonamento(e) {
    const db = readLocalDB();
    db.escalonamentos.push(e);
    writeLocalDB(db);
  },
  async registrarAck(id, ackEm) {
    const db = readLocalDB();
    const i = db.escalonamentos.findIndex((e) => e.id === id);
    if (i !== -1) { db.escalonamentos[i].ack_em = ackEm; writeLocalDB(db); }
  },

  async getOSs() { return readLocalDB().oss; },
  async getOSById(id) {
    return readLocalDB().oss.find((o) => o.id === id) || null;
  },
  async getOSsByCondominio(condominioId) {
    return readLocalDB().oss.filter((o) => o.condominio_id === condominioId);
  },
  async insertOS(os) {
    const db = readLocalDB();
    db.oss.push(os);
    writeLocalDB(db);
  },
  async updateOS(id, updates) {
    const db = readLocalDB();
    const i = db.oss.findIndex((o) => o.id === id);
    if (i === -1) return null;
    db.oss[i] = { ...db.oss[i], ...updates };
    writeLocalDB(db);
    return db.oss[i];
  },

  async getChecklistByOS(osId) {
    return readLocalDB().checklist_items.filter((c) => c.os_id === osId);
  },
  async insertChecklistItem(item) {
    const db = readLocalDB();
    db.checklist_items.push(item);
    writeLocalDB(db);
  },
  async updateChecklistItem(id, updates) {
    const db = readLocalDB();
    const i = db.checklist_items.findIndex((c) => c.id === id);
    if (i === -1) return null;
    db.checklist_items[i] = { ...db.checklist_items[i], ...updates };
    writeLocalDB(db);
    return db.checklist_items[i];
  },

  async getFotosByOS(osId) {
    return readLocalDB().fotos.filter((f) => f.os_id === osId);
  },
  async insertFoto(f) {
    const db = readLocalDB();
    db.fotos.push(f);
    writeLocalDB(db);
  },

  async getAuditLogs() { return readLocalDB().audit_logs; },
  async getAuditLogsByEntidade(entidade, entidadeId) {
    return readLocalDB().audit_logs.filter((l) => l.entidade === entidade && l.entidade_id === entidadeId);
  },
  async insertAuditLog(log) {
    const db = readLocalDB();
    db.audit_logs.unshift(log);
    writeLocalDB(db);
  },
  async getSessionLogs() { return readLocalDB().session_logs; },
  async insertSessionLog(log) {
    const db = readLocalDB();
    db.session_logs.unshift(log);
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
    // require() síncrono deliberado: backend() precisa retornar sem await (todo
    // Database.* chama backend().metodo() direto), então import() dinâmico
    // exigiria tornar backend() assíncrono e reescrever cada chamada da classe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pgBackend } = require('./db-postgres') as typeof import('./db-postgres');
    backendInstance = pgBackend;
  } else {
    backendInstance = jsonBackend;
  }
  return backendInstance;
}

// =====================================================================
// Adaptador geral — regras de negócio independem do backend
// =====================================================================

export class Database {
  // ----- Condomínio -----
  static getCondominios() { return backend().getCondominios(); }
  static getCondominioById(id: string) { return backend().getCondominioById(id); }

  static async createCondominio(data: Partial<Condominio>): Promise<Condominio> {
    const condominio: Condominio = {
      id: randomUUID(),
      nome: data.nome || '',
      endereco: data.endereco,
      administradora: data.administradora,
      monitoramento_ativo: data.monitoramento_ativo ?? false,
      criado_em: new Date().toISOString(),
    };
    await backend().insertCondominio(condominio);
    await this.createAuditLog({ entidade: 'condominio', entidade_id: condominio.id, acao: 'CRIADO', ator: 'sistema' });
    return condominio;
  }

  static updateCondominio(id: string, updates: Partial<Condominio>) { return backend().updateCondominio(id, updates); }

  // ----- Reservatório -----
  static getReservatoriosByCondominio(condominioId: string) { return backend().getReservatoriosByCondominio(condominioId); }

  // Resolve um alerta bruto da SensorLog ao condomínio real. Retorna null
  // quando o de-para ainda não foi cadastrado — quem chama decide o que
  // fazer (nunca descartar silenciosamente, ver docs/PRD-v2.md).
  static getReservatorioByNomeSensorlog(nomeSensorlog: string) {
    return backend().getReservatorioByNomeSensorlog(nomeSensorlog);
  }

  static async createReservatorio(data: Partial<Reservatorio>): Promise<Reservatorio> {
    const reservatorio: Reservatorio = {
      id: randomUUID(),
      condominio_id: data.condominio_id || '',
      nome_interno: data.nome_interno || '',
      nome_sensorlog: data.nome_sensorlog || '',
      tipo: data.tipo || 'torre',
      capacidade_litros: data.capacidade_litros,
      ultima_mensagem_recebida_em: data.ultima_mensagem_recebida_em,
    };
    await backend().insertReservatorio(reservatorio);
    return reservatorio;
  }

  static updateReservatorio(id: string, updates: Partial<Reservatorio>) { return backend().updateReservatorio(id, updates); }

  // ----- Contato -----
  static getContatosByCondominio(condominioId: string) { return backend().getContatosByCondominio(condominioId); }
  static getContatoNivel(condominioId: string, nivel: number) { return backend().getContatoNivel(condominioId, nivel); }

  static async createContato(data: Partial<Contato>): Promise<Contato> {
    const contato: Contato = {
      id: randomUUID(),
      condominio_id: data.condominio_id || '',
      papel: data.papel || 'zelador',
      nome: data.nome || '',
      canal_preferencial: data.canal_preferencial || 'whatsapp',
      identificador_canal: data.identificador_canal || '',
      nivel_escalonamento: data.nivel_escalonamento || 1,
      ativo: data.ativo ?? true,
    };
    await backend().insertContato(contato);
    return contato;
  }

  static updateContato(id: string, updates: Partial<Contato>) { return backend().updateContato(id, updates); }

  // ----- Equipamento -----
  static getEquipamentosByCondominio(condominioId: string) { return backend().getEquipamentosByCondominio(condominioId); }

  static async createEquipamento(data: Partial<Equipamento>): Promise<Equipamento> {
    const equipamento: Equipamento = {
      id: randomUUID(),
      condominio_id: data.condominio_id || '',
      tipo: data.tipo || '',
      modelo: data.modelo,
      potencia_hp: data.potencia_hp,
      cadastrado_em: new Date().toISOString(),
    };
    await backend().insertEquipamento(equipamento);
    return equipamento;
  }

  // ----- Usuário (RBAC) -----
  static getUsers() { return backend().getUsers(); }
  static getUserById(id: string) { return backend().getUserById(id); }
  static getUserByLogin(login: string) { return backend().getUserByLogin(login); }

  static async createUser(data: Partial<User> & { senha?: string }): Promise<User> {
    const user: User = {
      id: randomUUID(),
      nome: data.nome || '',
      login: (data.login || '').toLowerCase(),
      papel: data.papel || 'tecnico',
      condominio_id: data.condominio_id,
      senha_hash: data.senha ? hashPassword(data.senha) : (data.senha_hash || ''),
      ativo: data.ativo ?? true,
      criado_em: new Date().toISOString(),
    };
    await backend().insertUser(user);
    return user;
  }

  static updateUser(id: string, updates: Partial<User>) { return backend().updateUser(id, updates); }
  static deleteUser(id: string) { return backend().deleteUser(id); }

  static async getUsersByRole(papel: UserRole): Promise<User[]> {
    const users = await backend().getUsers();
    return users.filter((u) => u.papel === papel);
  }

  // ----- Alerta -----
  static getAlertas() { return backend().getAlertas(); }
  static getAlertaById(id: string) { return backend().getAlertaById(id); }
  static getAlertasByReservatorio(reservatorioId: string) { return backend().getAlertasByReservatorio(reservatorioId); }

  static async createAlerta(data: Partial<Alerta>): Promise<Alerta> {
    const alerta: Alerta = {
      id: randomUUID(),
      reservatorio_id: data.reservatorio_id || '',
      texto_original: data.texto_original,
      evento: data.evento || 'NIVEL_BAIXO',
      classificado_por: data.classificado_por || 'regra',
      recebido_em: new Date().toISOString(),
    };
    await backend().insertAlerta(alerta);
    await this.createAuditLog({
      entidade: 'alerta', entidade_id: alerta.id, acao: 'RECEBIDO', ator: 'hermes',
      detalhe: { evento: alerta.evento, classificado_por: alerta.classificado_por },
    });
    return alerta;
  }

  // ----- Playbook -----
  static getPlaybookAtivo(evento: EventoAlerta) { return backend().getPlaybookAtivo(evento); }
  static getPlaybooks() { return backend().getPlaybooks(); }

  static async createPlaybook(data: Partial<Playbook>): Promise<Playbook> {
    const playbook: Playbook = {
      id: randomUUID(),
      evento: data.evento || 'NIVEL_BAIXO',
      versao: data.versao || 1,
      conteudo: data.conteudo || {},
      ativo: data.ativo ?? true,
      criado_em: new Date().toISOString(),
    };
    await backend().insertPlaybook(playbook);
    return playbook;
  }

  // ----- Escalonamento -----
  static getEscalonamentosByAlerta(alertaId: string) { return backend().getEscalonamentosByAlerta(alertaId); }

  static async createEscalonamento(data: Partial<Escalonamento>): Promise<Escalonamento> {
    const escalonamento: Escalonamento = {
      id: randomUUID(),
      alerta_id: data.alerta_id || '',
      contato_id: data.contato_id || '',
      nivel: data.nivel || 1,
      canal_usado: data.canal_usado,
      enviado_em: new Date().toISOString(),
    };
    await backend().insertEscalonamento(escalonamento);
    return escalonamento;
  }

  static async registrarAck(id: string): Promise<void> {
    await backend().registrarAck(id, new Date().toISOString());
  }

  // ----- OS -----
  static getOSs() { return backend().getOSs(); }
  static getOSById(id: string) { return backend().getOSById(id); }
  static getOSsByCondominio(condominioId: string) { return backend().getOSsByCondominio(condominioId); }

  static async createOS(data: Partial<OS>): Promise<OS> {
    const os: OS = {
      id: randomUUID(),
      condominio_id: data.condominio_id || '',
      tipo: data.tipo || 'preventiva',
      origem: data.origem || 'manual',
      alerta_id: data.alerta_id,
      status: 'aberta',
      // Corretiva nasce alta por padrão (indica problema já ocorrendo);
      // preventiva nasce média — quem cria pode sempre ajustar.
      prioridade: data.prioridade || (data.tipo === 'corretiva' ? 'alta' : 'media'),
      tecnico_id: data.tecnico_id,
      observacao: data.observacao,
      criado_em: new Date().toISOString(),
    };
    await backend().insertOS(os);
    await this.createAuditLog({
      entidade: 'os', entidade_id: os.id, acao: 'CRIADA', ator: data.origem === 'hermes_automatica' ? 'hermes' : 'usuario',
      detalhe: { tipo: os.tipo, origem: os.origem },
    });
    return os;
  }

  static updateOS(id: string, updates: Partial<OS>) { return backend().updateOS(id, updates); }

  // Finaliza a OS só se todos os itens obrigatórios do checklist estiverem
  // concluídos — a trava de qualidade descrita no PRD.
  static async finalizarOS(id: string, updates: Partial<OS>): Promise<OS | null> {
    const itens = await backend().getChecklistByOS(id);
    const pendente = itens.some((i) => i.obrigatorio && !i.concluido);
    if (pendente) {
      throw new Error('Existem itens obrigatórios do checklist não concluídos.');
    }
    const os = await backend().updateOS(id, { ...updates, status: 'finalizada', saida_em: new Date().toISOString() });
    if (os) {
      await this.createAuditLog({ entidade: 'os', entidade_id: id, acao: 'FINALIZADA', ator: 'usuario' });
    }
    return os;
  }

  // ----- Checklist -----
  static getChecklistByOS(osId: string) { return backend().getChecklistByOS(osId); }

  static async createChecklistItem(data: Partial<ChecklistItem>): Promise<ChecklistItem> {
    const item: ChecklistItem = {
      id: randomUUID(),
      os_id: data.os_id || '',
      equipamento_id: data.equipamento_id,
      descricao: data.descricao || '',
      obrigatorio: data.obrigatorio ?? true,
      concluido: false,
    };
    await backend().insertChecklistItem(item);
    return item;
  }

  static async concluirChecklistItem(id: string): Promise<ChecklistItem | null> {
    return backend().updateChecklistItem(id, { concluido: true, concluido_em: new Date().toISOString() });
  }

  // ----- Foto -----
  static getFotosByOS(osId: string) { return backend().getFotosByOS(osId); }

  static async createFoto(data: Partial<Foto>): Promise<Foto> {
    const foto: Foto = {
      id: randomUUID(),
      os_id: data.os_id || '',
      momento: data.momento || 'antes',
      url: data.url || '',
      enviado_em: new Date().toISOString(),
    };
    await backend().insertFoto(foto);
    return foto;
  }

  // ----- Auditoria -----
  static getAuditLogs() { return backend().getAuditLogs(); }
  static getAuditLogsByEntidade(entidade: string, entidadeId: string) { return backend().getAuditLogsByEntidade(entidade, entidadeId); }

  static async createAuditLog(data: Partial<AuditLog>): Promise<AuditLog> {
    const log: AuditLog = {
      id: randomUUID(),
      entidade: data.entidade || '',
      entidade_id: data.entidade_id,
      acao: data.acao || '',
      ator: data.ator || 'sistema',
      detalhe: data.detalhe,
      criado_em: new Date().toISOString(),
    };
    await backend().insertAuditLog(log);
    return log;
  }

  static getSessionLogs() { return backend().getSessionLogs(); }

  static async createSessionLog(data: Partial<SessionLog>): Promise<SessionLog> {
    const log: SessionLog = {
      id: randomUUID(),
      user_name: data.user_name || 'Desconhecido',
      role: data.role || 'tecnico',
      action: data.action || 'login',
      ip_address: data.ip_address,
      created_at: new Date().toISOString(),
    };
    await backend().insertSessionLog(log);
    return log;
  }
}
