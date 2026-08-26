-- =====================================================================
-- Amotex Prevent — Sistema de OS — Schema PostgreSQL
-- =====================================================================
-- Baseado em: docs/Modelo-de-Dados.md (Amotex Prevent)
-- O app auto-provisiona estas tabelas na primeira conexão (src/lib/db-postgres.ts).
-- Este arquivo serve de referência/provisionamento manual.
-- Datas em TIMESTAMPTZ.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS condominio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  endereco TEXT,
  administradora TEXT,
  monitoramento_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ponto monitorado dentro de um condomínio. nome_sensorlog é a chave de
-- resolução do alerta: a mensagem da SensorLog referencia o reservatório,
-- não o condomínio diretamente.
CREATE TABLE IF NOT EXISTS reservatorio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id UUID NOT NULL REFERENCES condominio(id) ON DELETE CASCADE,
  nome_interno TEXT NOT NULL,
  nome_sensorlog TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('cisterna', 'superior', 'torre')),
  capacidade_litros INTEGER,
  ultima_mensagem_recebida_em TIMESTAMPTZ
);

-- Quem é notificado, em qual canal, por condomínio. nivel_escalonamento
-- é dado por linha (não fixo em código) para permitir cadeia própria por
-- condomínio sem alterar a aplicação.
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
  papel TEXT NOT NULL CHECK (papel IN ('admin', 'tecnico', 'sindico')),
  condominio_id UUID REFERENCES condominio(id) ON DELETE SET NULL, -- só p/ papel=sindico
  senha_hash TEXT NOT NULL,
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
  alerta_id UUID REFERENCES alerta(id), -- só se origem = hermes_automatica
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'finalizada', 'cancelada')),
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
  ator TEXT NOT NULL, -- usuario, "hermes" ou "n8n"
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
