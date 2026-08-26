// Backend PostgreSQL do NexusFlow — ativado quando DATABASE_URL está definido.
// Auto-provisiona o schema (CREATE TABLE IF NOT EXISTS) e os usuários padrão
// na primeira conexão, então o app sobe num banco vazio sem passos manuais.
// O arquivo postgres/schema.sql espelha este schema para o provedor.
// eslint-disable-next-line @typescript-eslint/no-require-imports
type Pool = InstanceType<typeof import('pg').Pool>;
import type { DbBackend, Dossier, ActivityLog, SessionLog, User, PushSubscription } from './db';
import { defaultUsers } from './db';

// Campos do dossiê além do id/created_at/updated_at (mapeamento 1:1 com a interface Dossier).
const TEXT_FIELDS = [
  'client_name', 'cpf', 'phone', 'email', 'address',
  'gov_level', 'gov_login', 'gov_password_encrypted',
  'status', 'current_step',
  'photo_doc_frente_url', 'photo_doc_verso_url', 'photo_doc_completo_url', 'photo_cnh_url',
  'comprovante_endereco_url', 'antecedentes_url', 'certificado_a1_url', 'certificado_a1_nome', 'documento_b_url',
  'cnpj_comprovante_url', 'inscricao_municipal_url', 'inscricao_estadual_url',
  'opcao_simples_url', 'certidao_inteiro_teor_url',
  'doc_extra_1_url', 'doc_extra_1_nome', 'doc_extra_2_url', 'doc_extra_2_nome',
  'doc_extra_3_url', 'doc_extra_3_nome',
  'cnpj_number', 'protocolo', 't2_new_email', 't2_new_email_senha_encrypted', 't2_new_phone', 't1_justification',
  'assigned_to', 'captured_by', 'resp_certificacao', 'resp_abertura', 'terceiro_responsavel', 'contador_abertura',
  'sla_deadline',
  'empresa_nome', 'nome_fantasia', 'empresa_endereco', 'cnae', 'capital_social', 'quadro_societario',
  'regime_tributario', 'porte_empresa', 'forma_atuacao', 'gov_socios', 'forma_pagamento', 'codigo_acesso',
  'bird_id_cert_url', 'agendamento_cert',
  'agendamento_status', 'agendamento_recusa_motivo',
  'agendamento_decidido_por', 'agendamento_decidido_em',
  'bird_id_done_em', 'bird_id_done_por', 'a1_done_em', 'a1_done_por',
  'abertura_done_em', 'abertura_done_por',
  'bird_pago_em', 'bird_pago_por', 'a1_pago_em', 'a1_pago_por',
  'colaborador_pago_em', 'colaborador_pago_por',
  'captador_pago_em', 'captador_pago_por', 'captador_pagamentos_mensais',
  'cert_docs_recusados',
  'reagendamento_pendente', 'reagendamento_de', 'reagendamento_justificativa',
  'reagendamento_por', 'reagendamento_em',
  'cert_certificadora', 'cert_sistema_usado', 'cert_aparelho', 'cert_email',
  'cert_email_senha_encrypted', 'cert_senha_acesso_encrypted',
  'projeto', 'projeto_parceiro',
  'gestor_note',
  'empresa_aberta_em', 'terceiro_docs_baixados_em',
] as const;

const BOOL_FIELDS = [
  'empresa_aberta', 'bird_id_done', 'abertura_done', 'a1_done',
  'cad_junta', 'cad_receita', 'cad_estado', 'cad_prefeitura',
  'planilha_mensalidade', 'planilha_simples', 'envio_tfe', 'opcao_simples',
  'criar_pasta_rede', 'gov_2fa_disabled',
  'bird_pago', 'a1_pago', 'colaborador_pago', 'captador_pago',
  'terceiro_docs_baixados',
] as const;

// Colunas que já existiam como BOOLEAN por engano em deploys anteriores
// (bird_id_cert_url é URL, agendamento_cert é data/hora ISO — nunca deveriam
// ter sido BOOLEAN). Corrige o tipo em bancos já provisionados.
const TEXT_TYPE_FIXUPS = ['bird_id_cert_url', 'agendamento_cert'] as const;

const ALL_FIELDS: string[] = ['id', ...TEXT_FIELDS, ...BOOL_FIELDS, 'created_at', 'updated_at'];

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

// Datas/horas armazenadas como TEXT (ISO 8601) para manter exatamente o mesmo
// formato do backend JSON — o app inteiro compara/exibe strings ISO.
async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = runSchemaMigration().catch((e) => {
      // Não cacheia falha pra sempre — se um ALTER/CREATE quebrar no meio
      // (ex.: conexão instável), a próxima chamada tenta migrar de novo em
      // vez de toda query do processo passar a falhar até reiniciar
      // manualmente (incidente real já documentado na skill nexusflow-context).
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function runSchemaMigration(): Promise<void> {
  const p = getPool();
    const textCols = TEXT_FIELDS.map((f) => `${f} TEXT`).join(',\n          ');
    const boolCols = BOOL_FIELDS.map((f) => `${f} BOOLEAN DEFAULT FALSE`).join(',\n          ');
    await p.query(`
      CREATE TABLE IF NOT EXISTS dossiers (
        id TEXT PRIMARY KEY,
        ${textCols},
        ${boolCols},
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dossiers_protocolo ON dossiers (protocolo);
      CREATE INDEX IF NOT EXISTS idx_dossiers_t2_phone ON dossiers (t2_new_phone);
      CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers (status);

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        dossier_id TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        details TEXT NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_dossier ON activity_logs (dossier_id);

      CREATE TABLE IF NOT EXISTS session_logs (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        role TEXT NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_logs_user ON session_logs (user_name);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS os_tasks (
        id TEXT PRIMARY KEY,
        dossier_id TEXT NOT NULL,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        text TEXT NOT NULL,
        done BOOLEAN DEFAULT FALSE NOT NULL,
        done_by TEXT,
        created_at TEXT NOT NULL,
        done_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_dossier ON os_tasks (dossier_id);

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_name);
    `);

    // Migração: adiciona colunas novas em bancos já provisionados
    // (CREATE TABLE IF NOT EXISTS não altera tabelas existentes).
    for (const f of TEXT_FIELDS) {
      await p.query(`ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS ${f} TEXT;`);
    }
    await p.query(`ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS deleted_at TEXT;`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_dossiers_deleted ON dossiers (deleted_at);`);
    await p.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terceiro_projeto TEXT;`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gestor_projetos TEXT;`);
    for (const f of BOOL_FIELDS) {
      await p.query(`ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS ${f} BOOLEAN DEFAULT FALSE;`);
    }
    // Corrige colunas que tinham sido criadas como BOOLEAN por engano
    // (bird_id_cert_url é URL, agendamento_cert é data/hora ISO).
    for (const f of TEXT_TYPE_FIXUPS) {
      await p.query(`ALTER TABLE dossiers ALTER COLUMN ${f} TYPE TEXT USING ${f}::TEXT;`);
      await p.query(`ALTER TABLE dossiers ALTER COLUMN ${f} DROP DEFAULT;`);
    }

    // Backfill: cert_email/cert_aparelho auto-preenchidos a partir do
    // vínculo (t2_new_email/t2_new_phone) só passaram a ser gravados no
    // momento em que o terceiro salva (api/dossiers/[id]/terceiro-update,
    // 21/07/2026) — OS que já tinham o vínculo definido ANTES dessa
    // mudança nunca disparam esse auto-preenchimento de novo (só acontece
    // na gravação, não é recalculado depois). Pedido do gestor
    // (24/07/2026): aplicar em TODAS as OS que já têm o vínculo definido,
    // não só nas novas. Roda a cada subida (idempotente — só toca
    // linhas onde o campo de destino ainda está vazio, nunca sobrescreve
    // um valor já definido pelo certificador).
    await p.query(`
      UPDATE dossiers
      SET cert_email = t2_new_email
      WHERE (cert_email IS NULL OR cert_email = '')
        AND t2_new_email IS NOT NULL AND t2_new_email != '';
    `);
    await p.query(`
      UPDATE dossiers
      SET cert_aparelho = t2_new_phone
      WHERE (cert_aparelho IS NULL OR cert_aparelho = '')
        AND t2_new_phone IS NOT NULL AND t2_new_phone != '';
    `);

    // Usuários padrão na primeira subida (senhas bcrypt; trocar em produção).
    const { rows } = await p.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n === 0) {
      for (const u of defaultUsers()) {
        await p.query(
          'INSERT INTO users (id, name, username, password, role, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [u.id, u.name, u.username, u.password, u.role, u.active, u.created_at]
        );
      }
      console.log('[db-postgres] Usuários padrão criados (trocar senhas!).');
    }
}

async function q(text: string, params?: any[]) {
  await ensureSchema();
  return getPool().query(text, params);
}

// Converte linha do banco → Dossier (remove NULLs para igualar o backend JSON).
function rowToDossier(row: any): Dossier {
  const d: any = {};
  for (const f of ALL_FIELDS) {
    if (row[f] !== null && row[f] !== undefined) d[f] = row[f];
  }
  return d as Dossier;
}

export const pgBackend: DbBackend = {
  async getDossiers() {
    const { rows } = await q('SELECT * FROM dossiers WHERE deleted_at IS NULL ORDER BY created_at DESC');
    return rows.map(rowToDossier);
  },

  async getDossierById(id) {
    const { rows } = await q('SELECT * FROM dossiers WHERE id = $1 AND deleted_at IS NULL', [id]);
    return rows[0] ? rowToDossier(rows[0]) : null;
  },

  async insertDossier(d) {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const f of ALL_FIELDS) {
      const v = (d as any)[f];
      if (v === undefined) continue;
      cols.push(f);
      vals.push(v);
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await q(`INSERT INTO dossiers (${cols.join(', ')}) VALUES (${placeholders})`, vals);
  },

  async updateDossier(id, updates) {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of ALL_FIELDS) {
      if (f === 'id' || f === 'created_at') continue;
      const v = (updates as any)[f];
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${f} = $${vals.length}`);
    }
    vals.push(new Date().toISOString());
    sets.push(`updated_at = $${vals.length}`);
    vals.push(id);
    const { rows } = await q(
      `UPDATE dossiers SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    return rows[0] ? rowToDossier(rows[0]) : null;
  },

  async deleteDossier(id) {
    const res = await q(
      'UPDATE dossiers SET deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL',
      [id, new Date().toISOString()]
    );
    return (res.rowCount || 0) > 0;
  },

  async getDeletedDossiers() {
    const { rows } = await q('SELECT * FROM dossiers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
    return rows.map(rowToDossier);
  },

  async restoreDossier(id) {
    const res = await q(
      'UPDATE dossiers SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );
    return (res.rowCount || 0) > 0;
  },

  async getLogs() {
    const { rows } = await q('SELECT * FROM activity_logs ORDER BY created_at DESC');
    return rows as ActivityLog[];
  },

  async getLogsByDossier(dossierId) {
    const { rows } = await q(
      'SELECT * FROM activity_logs WHERE dossier_id = $1 ORDER BY created_at DESC',
      [dossierId]
    );
    return rows as ActivityLog[];
  },

  async insertLog(log) {
    await q(
      'INSERT INTO activity_logs (id, dossier_id, user_id, user_name, action_type, details, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [log.id, log.dossier_id, log.user_id ?? null, log.user_name, log.action_type, log.details, log.ip_address ?? null, log.created_at]
    );
  },

  async getSessionLogs() {
    const { rows } = await q('SELECT * FROM session_logs ORDER BY created_at DESC');
    return rows as SessionLog[];
  },

  async insertSessionLog(log) {
    await q(
      'INSERT INTO session_logs (id, user_name, role, action, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [log.id, log.user_name, log.role, log.action, log.ip_address ?? null, log.created_at]
    );
  },

  async getUsers() {
    const { rows } = await q('SELECT * FROM users ORDER BY created_at');
    return rows as User[];
  },

  async getUserByUsername(username) {
    const { rows } = await q('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [String(username)]);
    return (rows[0] as User) || null;
  },

  async getUserById(id) {
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
    return (rows[0] as User) || null;
  },

  async insertUser(u) {
    await q(
      'INSERT INTO users (id, name, username, password, role, active, created_at, terceiro_projeto, gestor_projetos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [u.id, u.name, u.username, u.password, u.role, u.active, u.created_at, u.terceiro_projeto ?? null, u.gestor_projetos ?? null]
    );
  },

  async updateUser(id, updates) {
    const allowed = ['name', 'username', 'password', 'role', 'active', 'terceiro_projeto', 'gestor_projetos'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of allowed) {
      const v = (updates as any)[f];
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${f} = $${vals.length}`);
    }
    if (sets.length === 0) return this.getUserById(id);
    vals.push(id);
    const { rows } = await q(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    return (rows[0] as User) || null;
  },

  async deleteUser(id) {
    const res = await q('DELETE FROM users WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  },

  async getTasksByDossier(dossierId) {
    const { rows } = await q('SELECT * FROM os_tasks WHERE dossier_id = $1 ORDER BY created_at DESC', [dossierId]);
    return rows as import('./db').OsTask[];
  },

  async getTasksForUser(userName) {
    const { rows } = await q(
      `SELECT t.*, d.client_name, d.cpf, d.phone, d.status AS dossier_status
       FROM os_tasks t
       LEFT JOIN dossiers d ON d.id = t.dossier_id
       WHERE t.to_user = $1 ORDER BY t.created_at DESC`,
      [userName]
    );
    return rows as (import('./db').OsTask & { client_name?: string; cpf?: string; phone?: string; dossier_status?: string })[];
  },

  async insertTask(task) {
    await q(
      'INSERT INTO os_tasks (id, dossier_id, from_user, to_user, text, done, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [task.id, task.dossier_id, task.from_user, task.to_user, task.text, false, task.created_at]
    );
  },

  async completeTask(id, doneBy, doneAt) {
    await q('UPDATE os_tasks SET done = TRUE, done_by = $2, done_at = $3 WHERE id = $1', [id, doneBy, doneAt]);
  },

  async deleteTask(id) {
    await q('DELETE FROM os_tasks WHERE id = $1', [id]);
  },

  async getPushSubscriptionsByUser(userName) {
    const { rows } = await q('SELECT * FROM push_subscriptions WHERE user_name = $1', [userName]);
    return rows as PushSubscription[];
  },

  async insertPushSubscription(sub) {
    await q(
      `INSERT INTO push_subscriptions (id, user_name, endpoint, p256dh, auth, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_name = $2, p256dh = $4, auth = $5`,
      [sub.id, sub.user_name, sub.endpoint, sub.p256dh, sub.auth, sub.created_at]
    );
  },

  async deletePushSubscriptionByEndpoint(endpoint) {
    await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  },
};
