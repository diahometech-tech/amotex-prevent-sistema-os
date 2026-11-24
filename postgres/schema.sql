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
  papel TEXT NOT NULL CHECK (papel IN ('zelador', 'gerente', 'portaria', 'sindico', 'administradora', 'conservadora', 'plantao')),
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
  papel TEXT NOT NULL CHECK (papel IN ('admin', 'secretaria', 'tecnico', 'sindico')),
  condominio_id UUID REFERENCES condominio(id) ON DELETE SET NULL, -- só p/ papel=sindico
  especialidade TEXT CHECK (especialidade IN ('corretiva', 'preventiva')), -- só técnico; NULL = as duas
  telegram_chat_id TEXT, -- avisos operacionais (corretiva aberta/assumida)
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
  alerta_id UUID REFERENCES alerta(id), -- só se origem = hermes_automatica
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'finalizada', 'cancelada')),
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
  tecnico_id UUID REFERENCES usuario(id),
  entrada_em TIMESTAMPTZ,
  saida_em TIMESTAMPTZ,
  observacao TEXT,
  data_programada DATE, -- dia da visita (rota do dia do técnico)
  solicitante_nome TEXT, -- chamado de corretiva sem sensor: quem pediu
  solicitante_telefone TEXT,
  descricao_problema TEXT,
  os_origem_id UUID REFERENCES os(id) ON DELETE SET NULL, -- corretiva aberta de dentro da preventiva
  equipamento_id UUID REFERENCES equipamento(id) ON DELETE SET NULL, -- equipamento com defeito
  canal_abertura TEXT, -- escritorio | tecnico | condominio (nulo = OS antiga)
  a_caminho_em TIMESTAMPTZ, -- "Estou a caminho" do técnico
  a_caminho_por TEXT,
  chegada_lat DOUBLE PRECISION, -- localização do celular (só o escritório vê)
  chegada_lng DOUBLE PRECISION,
  chegada_precisao_m DOUBLE PRECISION,
  finalizacao_lat DOUBLE PRECISION,
  finalizacao_lng DOUBLE PRECISION,
  finalizacao_precisao_m DOUBLE PRECISION,
  assinatura_zelador_url TEXT,
  assinatura_zelador_nome TEXT, -- quem assinou pelo condomínio (obrigatório para finalizar)
  assinatura_zelador_documento TEXT, -- RG/CPF livre, opcional
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
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id TEXT, -- id da fila offline do celular (reenvio não duplica)
  equipamento_id UUID REFERENCES equipamento(id) ON DELETE SET NULL -- foto do equipamento na preventiva
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

CREATE TABLE IF NOT EXISTS configuracao (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Aparelhos que recebem aviso do app (Web Push). Endpoint único: se outro
-- usuário entra no mesmo aparelho, a inscrição passa para ele.
CREATE TABLE IF NOT EXISTS push_inscricao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_inscricao_usuario ON push_inscricao(usuario_id);

CREATE INDEX IF NOT EXISTS idx_reservatorio_condominio ON reservatorio(condominio_id);
CREATE INDEX IF NOT EXISTS idx_contato_condominio ON contato(condominio_id);
CREATE INDEX IF NOT EXISTS idx_equipamento_condominio ON equipamento(condominio_id);
CREATE INDEX IF NOT EXISTS idx_alerta_reservatorio ON alerta(reservatorio_id);
CREATE INDEX IF NOT EXISTS idx_os_condominio ON os(condominio_id);
CREATE INDEX IF NOT EXISTS idx_os_data_programada ON os(data_programada);
CREATE INDEX IF NOT EXISTS idx_checklist_os ON checklist_item(os_id);
CREATE INDEX IF NOT EXISTS idx_foto_os ON foto(os_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_foto_client_id ON foto(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_os_origem ON os(os_origem_id);
CREATE INDEX IF NOT EXISTS idx_escalonamento_alerta ON escalonamento(alerta_id);

-- Região do condomínio (22/11): agrupa o planejamento e a rota do dia. Opcional.
ALTER TABLE condominio ADD COLUMN IF NOT EXISTS regiao TEXT;

-- Escala de plantão (22/11): uma linha = alguém de plantão no intervalo.
-- Pode haver mais de uma pessoa no mesmo intervalo.
CREATE TABLE IF NOT EXISTS plantao_escala (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_plantao_escala_periodo ON plantao_escala(inicio, fim);

-- Acompanhamento da rota do técnico (24/11): posição enviada pelo celular no
-- trecho "a caminho" (hoje pelo navegador; o app Android usará o mesmo
-- endpoint). Só a última é exibida; as com mais de 7 dias são apagadas ao
-- gravar uma nova.
CREATE TABLE IF NOT EXISTS os_posicao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES os(id) ON DELETE CASCADE,
  tecnico_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  precisao_m INTEGER,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_os_posicao_os ON os_posicao(os_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS idx_os_posicao_registrado ON os_posicao(registrado_em);

-- Localização do condomínio no mapa (destino da estimativa de chegada).
-- origem: 'chegada' (gravada pela primeira chegada com boa precisão) | 'manual'.
ALTER TABLE condominio ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE condominio ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE condominio ADD COLUMN IF NOT EXISTS localizacao_origem TEXT;
ALTER TABLE condominio ADD COLUMN IF NOT EXISTS localizacao_em TIMESTAMPTZ;
