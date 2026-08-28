// Backend PostgreSQL — ativado quando DATABASE_URL está definido.
// Auto-provisiona o schema (CREATE TABLE IF NOT EXISTS) na primeira conexão,
// então o app sobe num banco vazio sem passos manuais. O arquivo
// postgres/schema.sql espelha este schema para referência/provisionamento manual.
type Pool = InstanceType<typeof import('pg').Pool>;
import type {
  DbBackend, Condominio, Reservatorio, Contato, Equipamento, User, EventoAlerta,
  Alerta, Playbook, Escalonamento, OS, ChecklistItem, Foto, AuditLog, SessionLog,
} from './db';
import { defaultUsers } from './db';

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require('pg') as typeof import('pg');
    const url = process.env.DATABASE_URL ?? '';
    pool = new PgPool({
      connectionString: url,
      max: 10,
      ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = runSchemaMigration().catch((e) => {
      // Não cacheia falha pra sempre — se a migração quebrar no meio (ex.:
      // conexão instável), a próxima chamada tenta de novo em vez de toda
      // query do processo passar a falhar até reiniciar manualmente.
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function runSchemaMigration(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS condominio (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome TEXT NOT NULL,
      endereco TEXT,
      administradora TEXT,
      monitoramento_ativo BOOLEAN NOT NULL DEFAULT FALSE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reservatorio (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      condominio_id UUID NOT NULL REFERENCES condominio(id) ON DELETE CASCADE,
      nome_interno TEXT NOT NULL,
      nome_sensorlog TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL CHECK (tipo IN ('cisterna', 'superior', 'torre')),
      capacidade_litros INTEGER,
      ultima_mensagem_recebida_em TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS contato (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      condominio_id UUID NOT NULL REFERENCES condominio(id) ON DELETE CASCADE,
      papel TEXT NOT NULL CHECK (papel IN ('zelador', 'sindico', 'administradora', 'conservadora', 'plantao')),
      nome TEXT NOT NULL,
      canal_preferencial TEXT NOT NULL CHECK (canal_preferencial IN ('telegram', 'whatsapp', 'email')),
      identificador_canal TEXT NOT NULL,
      nivel_escalonamento INTEGER NOT NULL CHECK (nivel_escalonamento IN (1, 2, 3)),
      ativo BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS equipamento (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      condominio_id UUID NOT NULL REFERENCES condominio(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      modelo TEXT,
      potencia_hp NUMERIC,
      cadastrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuario (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      papel TEXT NOT NULL CHECK (papel IN ('admin', 'tecnico', 'sindico')),
      condominio_id UUID REFERENCES condominio(id) ON DELETE SET NULL,
      senha_hash TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS alerta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reservatorio_id UUID NOT NULL REFERENCES reservatorio(id) ON DELETE CASCADE,
      texto_original TEXT,
      evento TEXT NOT NULL CHECK (evento IN (
        'NIVEL_BAIXO', 'NIVEL_CRITICO', 'NIVEL_MUITO_BAIXO',
        'TENDENCIA_QUEDA_MADRUGADA', 'RECUPEROU', 'SEM_REPORTE'
      )),
      classificado_por TEXT NOT NULL CHECK (classificado_por IN ('regra', 'llm', 'humano')),
      recebido_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS playbook (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      evento TEXT NOT NULL,
      versao INTEGER NOT NULL DEFAULT 1,
      conteudo JSONB NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS escalonamento (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alerta_id UUID NOT NULL REFERENCES alerta(id) ON DELETE CASCADE,
      contato_id UUID NOT NULL REFERENCES contato(id),
      nivel INTEGER NOT NULL,
      canal_usado TEXT,
      enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      ack_em TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS os (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      condominio_id UUID NOT NULL REFERENCES condominio(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('preventiva', 'corretiva')),
      origem TEXT NOT NULL CHECK (origem IN ('manual', 'hermes_automatica')),
      alerta_id UUID REFERENCES alerta(id),
      status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'finalizada', 'cancelada')),
      prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
      tecnico_id UUID REFERENCES usuario(id),
      entrada_em TIMESTAMPTZ,
      saida_em TIMESTAMPTZ,
      observacao TEXT,
      assinatura_zelador_url TEXT,
      assinatura_tecnico_url TEXT,
      pdf_url TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS checklist_item (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      os_id UUID NOT NULL REFERENCES os(id) ON DELETE CASCADE,
      equipamento_id UUID REFERENCES equipamento(id),
      descricao TEXT NOT NULL,
      obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,
      concluido BOOLEAN NOT NULL DEFAULT FALSE,
      concluido_em TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS foto (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      os_id UUID NOT NULL REFERENCES os(id) ON DELETE CASCADE,
      momento TEXT NOT NULL CHECK (momento IN ('antes', 'depois')),
      url TEXT NOT NULL,
      enviado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_name TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('login', 'logout')),
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entidade TEXT NOT NULL,
      entidade_id UUID,
      acao TEXT NOT NULL,
      ator TEXT NOT NULL,
      detalhe JSONB,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_reservatorio_condominio ON reservatorio(condominio_id);
    CREATE INDEX IF NOT EXISTS idx_contato_condominio ON contato(condominio_id);
    CREATE INDEX IF NOT EXISTS idx_equipamento_condominio ON equipamento(condominio_id);
    CREATE INDEX IF NOT EXISTS idx_alerta_reservatorio ON alerta(reservatorio_id);
    CREATE INDEX IF NOT EXISTS idx_os_condominio ON os(condominio_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_os ON checklist_item(os_id);
    CREATE INDEX IF NOT EXISTS idx_foto_os ON foto(os_id);
    CREATE INDEX IF NOT EXISTS idx_escalonamento_alerta ON escalonamento(alerta_id);
  `);

  const { rows } = await p.query('SELECT COUNT(*)::int AS n FROM usuario');
  if (rows[0].n === 0) {
    for (const u of defaultUsers()) {
      await p.query(
        'INSERT INTO usuario (id, nome, login, papel, condominio_id, senha_hash, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [u.id, u.nome, u.login, u.papel, u.condominio_id ?? null, u.senha_hash, u.ativo, u.criado_em]
      );
    }
    console.log('[db-postgres] Usuários padrão criados (trocar senhas em produção).');
  }
}

async function q(text: string, params?: unknown[]) {
  await ensureSchema();
  return getPool().query(text, params);
}

export const pgBackend: DbBackend = {
  // ----- Condomínio -----
  async getCondominios() {
    const { rows } = await q('SELECT * FROM condominio ORDER BY criado_em DESC');
    return rows as Condominio[];
  },
  async getCondominioById(id) {
    const { rows } = await q('SELECT * FROM condominio WHERE id = $1', [id]);
    return (rows[0] as Condominio) || null;
  },
  async insertCondominio(c) {
    await q(
      'INSERT INTO condominio (id, nome, endereco, administradora, monitoramento_ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [c.id, c.nome, c.endereco ?? null, c.administradora ?? null, c.monitoramento_ativo, c.criado_em]
    );
  },
  async updateCondominio(id, updates) {
    const allowed = ['nome', 'endereco', 'administradora', 'monitoramento_ativo'];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return this.getCondominioById(id);
    vals.push(id);
    const { rows } = await q(`UPDATE condominio SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as Condominio) || null;
  },

  // ----- Reservatório -----
  async getReservatoriosByCondominio(condominioId) {
    const { rows } = await q('SELECT * FROM reservatorio WHERE condominio_id = $1', [condominioId]);
    return rows as Reservatorio[];
  },
  async getReservatorioByNomeSensorlog(nomeSensorlog) {
    const { rows } = await q('SELECT * FROM reservatorio WHERE nome_sensorlog = $1', [nomeSensorlog]);
    return (rows[0] as Reservatorio) || null;
  },
  async insertReservatorio(r) {
    await q(
      'INSERT INTO reservatorio (id, condominio_id, nome_interno, nome_sensorlog, tipo, capacidade_litros, ultima_mensagem_recebida_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [r.id, r.condominio_id, r.nome_interno, r.nome_sensorlog, r.tipo, r.capacidade_litros ?? null, r.ultima_mensagem_recebida_em ?? null]
    );
  },
  async updateReservatorio(id, updates) {
    const allowed = ['nome_interno', 'nome_sensorlog', 'tipo', 'capacidade_litros', 'ultima_mensagem_recebida_em'];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return null;
    vals.push(id);
    const { rows } = await q(`UPDATE reservatorio SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as Reservatorio) || null;
  },

  // ----- Contato -----
  async getContatosByCondominio(condominioId) {
    const { rows } = await q('SELECT * FROM contato WHERE condominio_id = $1', [condominioId]);
    return rows as Contato[];
  },
  async getContatoNivel(condominioId, nivel) {
    const { rows } = await q(
      'SELECT * FROM contato WHERE condominio_id = $1 AND nivel_escalonamento = $2 AND ativo = TRUE LIMIT 1',
      [condominioId, nivel]
    );
    return (rows[0] as Contato) || null;
  },
  async insertContato(c) {
    await q(
      'INSERT INTO contato (id, condominio_id, papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [c.id, c.condominio_id, c.papel, c.nome, c.canal_preferencial, c.identificador_canal, c.nivel_escalonamento, c.ativo]
    );
  },
  async updateContato(id, updates) {
    const allowed = ['papel', 'nome', 'canal_preferencial', 'identificador_canal', 'nivel_escalonamento', 'ativo'];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return null;
    vals.push(id);
    const { rows } = await q(`UPDATE contato SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as Contato) || null;
  },

  // ----- Equipamento -----
  async getEquipamentosByCondominio(condominioId) {
    const { rows } = await q('SELECT * FROM equipamento WHERE condominio_id = $1', [condominioId]);
    return rows as Equipamento[];
  },
  async getEquipamentos() {
    const { rows } = await q('SELECT * FROM equipamento ORDER BY tipo, modelo');
    return rows as Equipamento[];
  },
  async insertEquipamento(e) {
    await q(
      'INSERT INTO equipamento (id, condominio_id, tipo, modelo, potencia_hp, cadastrado_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.id, e.condominio_id, e.tipo, e.modelo ?? null, e.potencia_hp ?? null, e.cadastrado_em]
    );
  },

  // ----- Usuário -----
  async getUsers() {
    const { rows } = await q('SELECT * FROM usuario ORDER BY criado_em');
    return rows as User[];
  },
  async getUserById(id) {
    const { rows } = await q('SELECT * FROM usuario WHERE id = $1', [id]);
    return (rows[0] as User) || null;
  },
  async getUserByLogin(login) {
    const { rows } = await q('SELECT * FROM usuario WHERE LOWER(login) = LOWER($1)', [login]);
    return (rows[0] as User) || null;
  },
  async insertUser(u) {
    await q(
      'INSERT INTO usuario (id, nome, login, papel, condominio_id, senha_hash, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [u.id, u.nome, u.login, u.papel, u.condominio_id ?? null, u.senha_hash, u.ativo, u.criado_em]
    );
  },
  async updateUser(id, updates) {
    const allowed = ['nome', 'login', 'papel', 'condominio_id', 'senha_hash', 'ativo'];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return this.getUserById(id);
    vals.push(id);
    const { rows } = await q(`UPDATE usuario SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as User) || null;
  },
  async deleteUser(id) {
    const res = await q('DELETE FROM usuario WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  },

  // ----- Alerta -----
  async getAlertas() {
    const { rows } = await q('SELECT * FROM alerta ORDER BY recebido_em DESC');
    return rows as Alerta[];
  },
  async getAlertaById(id) {
    const { rows } = await q('SELECT * FROM alerta WHERE id = $1', [id]);
    return (rows[0] as Alerta) || null;
  },
  async getAlertasByReservatorio(reservatorioId) {
    const { rows } = await q('SELECT * FROM alerta WHERE reservatorio_id = $1 ORDER BY recebido_em DESC', [reservatorioId]);
    return rows as Alerta[];
  },
  async insertAlerta(a) {
    await q(
      'INSERT INTO alerta (id, reservatorio_id, texto_original, evento, classificado_por, recebido_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [a.id, a.reservatorio_id, a.texto_original ?? null, a.evento, a.classificado_por, a.recebido_em]
    );
  },

  // ----- Playbook -----
  async getPlaybookAtivo(evento: EventoAlerta) {
    const { rows } = await q(
      'SELECT * FROM playbook WHERE evento = $1 AND ativo = TRUE ORDER BY versao DESC LIMIT 1',
      [evento]
    );
    return (rows[0] as Playbook) || null;
  },
  async getPlaybooks() {
    const { rows } = await q('SELECT * FROM playbook ORDER BY evento, versao DESC');
    return rows as Playbook[];
  },
  async insertPlaybook(p) {
    await q(
      'INSERT INTO playbook (id, evento, versao, conteudo, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [p.id, p.evento, p.versao, JSON.stringify(p.conteudo), p.ativo, p.criado_em]
    );
  },

  // ----- Escalonamento -----
  async getEscalonamentosByAlerta(alertaId) {
    const { rows } = await q('SELECT * FROM escalonamento WHERE alerta_id = $1 ORDER BY enviado_em', [alertaId]);
    return rows as Escalonamento[];
  },
  async insertEscalonamento(e) {
    await q(
      'INSERT INTO escalonamento (id, alerta_id, contato_id, nivel, canal_usado, enviado_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.id, e.alerta_id, e.contato_id, e.nivel, e.canal_usado ?? null, e.enviado_em]
    );
  },
  async registrarAck(id, ackEm) {
    await q('UPDATE escalonamento SET ack_em = $2 WHERE id = $1', [id, ackEm]);
  },

  // ----- OS -----
  async getOSs() {
    const { rows } = await q('SELECT * FROM os ORDER BY criado_em DESC');
    return rows as OS[];
  },
  async getOSById(id) {
    const { rows } = await q('SELECT * FROM os WHERE id = $1', [id]);
    return (rows[0] as OS) || null;
  },
  async getOSsByCondominio(condominioId) {
    const { rows } = await q('SELECT * FROM os WHERE condominio_id = $1 ORDER BY criado_em DESC', [condominioId]);
    return rows as OS[];
  },
  async insertOS(os) {
    await q(
      `INSERT INTO os (id, condominio_id, tipo, origem, alerta_id, status, prioridade, tecnico_id, entrada_em, saida_em, observacao, assinatura_zelador_url, assinatura_tecnico_url, pdf_url, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [os.id, os.condominio_id, os.tipo, os.origem, os.alerta_id ?? null, os.status, os.prioridade, os.tecnico_id ?? null,
       os.entrada_em ?? null, os.saida_em ?? null, os.observacao ?? null,
       os.assinatura_zelador_url ?? null, os.assinatura_tecnico_url ?? null, os.pdf_url ?? null, os.criado_em]
    );
  },
  async updateOS(id, updates) {
    const allowed = [
      'status', 'prioridade', 'tecnico_id', 'entrada_em', 'saida_em', 'observacao',
      'assinatura_zelador_url', 'assinatura_tecnico_url', 'pdf_url',
    ];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return this.getOSById(id);
    vals.push(id);
    const { rows } = await q(`UPDATE os SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as OS) || null;
  },

  // ----- Checklist -----
  async getChecklistByOS(osId) {
    const { rows } = await q('SELECT * FROM checklist_item WHERE os_id = $1', [osId]);
    return rows as ChecklistItem[];
  },
  async insertChecklistItem(item) {
    await q(
      'INSERT INTO checklist_item (id, os_id, equipamento_id, descricao, obrigatorio, concluido, concluido_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [item.id, item.os_id, item.equipamento_id ?? null, item.descricao, item.obrigatorio, item.concluido, item.concluido_em ?? null]
    );
  },
  async updateChecklistItem(id, updates) {
    const allowed = ['descricao', 'obrigatorio', 'concluido', 'concluido_em'];
    const { sets, vals } = buildSet(allowed, updates);
    if (sets.length === 0) return null;
    vals.push(id);
    const { rows } = await q(`UPDATE checklist_item SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return (rows[0] as ChecklistItem) || null;
  },

  // ----- Foto -----
  async getFotosByOS(osId) {
    const { rows } = await q('SELECT * FROM foto WHERE os_id = $1', [osId]);
    return rows as Foto[];
  },
  async insertFoto(f) {
    await q(
      'INSERT INTO foto (id, os_id, momento, url, enviado_em) VALUES ($1,$2,$3,$4,$5)',
      [f.id, f.os_id, f.momento, f.url, f.enviado_em]
    );
  },

  // ----- Auditoria -----
  async getAuditLogs() {
    const { rows } = await q('SELECT * FROM audit_log ORDER BY criado_em DESC');
    return rows as AuditLog[];
  },
  async getAuditLogsByEntidade(entidade, entidadeId) {
    const { rows } = await q(
      'SELECT * FROM audit_log WHERE entidade = $1 AND entidade_id = $2 ORDER BY criado_em DESC',
      [entidade, entidadeId]
    );
    return rows as AuditLog[];
  },
  async insertAuditLog(log) {
    await q(
      'INSERT INTO audit_log (id, entidade, entidade_id, acao, ator, detalhe, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [log.id, log.entidade, log.entidade_id ?? null, log.acao, log.ator, log.detalhe ? JSON.stringify(log.detalhe) : null, log.criado_em]
    );
  },
  async getSessionLogs() {
    const { rows } = await q('SELECT * FROM session_log ORDER BY created_at DESC');
    return rows as SessionLog[];
  },
  async insertSessionLog(log) {
    await q(
      'INSERT INTO session_log (id, user_name, role, action, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [log.id, log.user_name, log.role, log.action, log.ip_address ?? null, log.created_at]
    );
  },
};

function buildSet(allowed: string[], updates: Record<string, unknown>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of allowed) {
    const v = updates[f];
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${f} = $${vals.length}`);
  }
  return { sets, vals };
}
