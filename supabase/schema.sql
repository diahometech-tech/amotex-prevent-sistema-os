-- Esquema do Banco de Dados PostgreSQL (Supabase) para o NexusFlow MVP

-- 1. ENUMS E PERFIS DE ACESSO
CREATE TYPE user_role AS ENUM ('captador', 'operador_certificacao', 'operador_abertura', 'gestor', 'admin', 'terceiro');
CREATE TYPE dossier_status AS ENUM ('captado', 't1_pendente', 't1_verde', 't1_vermelho', 't2_pendente', 't3_bird_id', 't3_abertura', 't4_a1', 'finalizado', 'cancelado');
CREATE TYPE gov_level AS ENUM ('ouro', 'prata');

-- Tabela de Perfis de Usuários (sincronizada com auth.users do Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'captador',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Habilitar Row Level Security (RLS) para perfis
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. TABELA DOSSIÊS (ORDENS DE SERVIÇO)
CREATE TABLE IF NOT EXISTS public.dossiers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_name TEXT NOT NULL,
    cpf TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT,
    gov_level gov_level NOT NULL DEFAULT 'prata',
    gov_login TEXT,
    gov_password_encrypted TEXT, -- Senha Gov encriptada por AES-256 no backend
    status dossier_status NOT NULL DEFAULT 'captado',
    current_step VARCHAR(50) NOT NULL DEFAULT 'captacao',
    
    -- URLs de documentos salvos no Supabase Storage (Bucket S3)
    photo_doc_frente_url TEXT,
    photo_doc_verso_url TEXT,
    comprovante_endereco_url TEXT,
    certificado_a1_url TEXT,
    documento_b_url TEXT,
    cnpj_comprovante_url TEXT,
    
    -- Dados de Abertura (T2)
    cnpj_number TEXT,
    empresa_aberta BOOLEAN DEFAULT FALSE NOT NULL,
    t2_new_email TEXT,
    t2_new_phone TEXT,
    
    -- Status T1 (Risco)
    t1_justification TEXT,
    
    -- Pessoas atribuídas e métricas
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    sla_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.dossiers ENABLE ROW LEVEL SECURITY;

-- 3. CHECKLIST OPERACIONAL T1 (RISCO)
CREATE TABLE IF NOT EXISTS public.checklists (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dossier_id UUID REFERENCES public.dossiers(id) ON DELETE CASCADE NOT NULL,
    item_name TEXT NOT NULL, -- ex: 'Processos Jurídicos', 'Redes Sociais'
    is_checked BOOLEAN DEFAULT FALSE NOT NULL,
    evidence_text TEXT,
    updated_by UUID REFERENCES public.profiles(id),
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;

-- 4. LOGS DE AUDITORIA IMUTÁVEIS (Trilha de Segurança)
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dossier_id UUID REFERENCES public.dossiers(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL, -- Copiado na criação para histórico mesmo se perfil for deletado
    action_type VARCHAR(100) NOT NULL, -- ex: 'GOV_PASSWORD_REVEALED', 'T1_APPROVED', 'OS_CREATED'
    details TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tornar a tabela activity_logs imutável por meio de RLS: apenas INSERT é permitido
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS da Tabela Logs (Segurança Estrita)
CREATE POLICY "Permitir leitura de logs apenas a administradores e gestores"
ON public.activity_logs FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() AND profiles.role IN ('gestor', 'admin')
    )
);

CREATE POLICY "Permitir inserção de logs para qualquer usuário autenticado"
ON public.activity_logs FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Impedir UPDATE e DELETE nos logs (Imutabilidade absoluta)
CREATE POLICY "Proibir atualização de logs" ON public.activity_logs FOR UPDATE USING (false);
CREATE POLICY "Proibir exclusão de logs" ON public.activity_logs FOR DELETE USING (false);

-- 5. TRILHAS AUTOMÁTICAS E TRIGGERS DE SLA E AUDITORIA
-- Trigger para sincronizar auth.users com public.profiles automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', 'Usuário Novo'),
    COALESCE((new.raw_user_meta_data->>'role')::user_role, 'captador'::user_role)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 6. ATUALIZAÇÃO 2026-06 — alinhamento com o modelo atual do app
--    (idempotente: pode rodar em banco já existente)
-- =====================================================================

-- Identificação e protocolo
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS captured_by TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS protocolo TEXT UNIQUE; -- identificador oficial pós-finalização (vínculo e-commerce)

-- Dados da Abertura da Empresa (Ordem de Serviço - Abertura / modelo Contex)
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS empresa_nome TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS nome_fantasia TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS cnae TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS capital_social TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS quadro_societario TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS regime_tributario TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS gov_socios TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS codigo_acesso TEXT;

-- Checklist operacional da abertura
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS cad_junta BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS cad_receita BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS cad_estado BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS cad_prefeitura BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS planilha_mensalidade BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS planilha_simples BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS envio_tfe BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS opcao_simples BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS criar_pasta_rede BOOLEAN DEFAULT FALSE;

-- Índice para busca por telefone do e-commerce e protocolo
CREATE INDEX IF NOT EXISTS idx_dossiers_t2_phone ON public.dossiers (t2_new_phone);
CREATE INDEX IF NOT EXISTS idx_dossiers_protocolo ON public.dossiers (protocolo);

-- =====================================================================
-- 7. POLÍTICAS RLS BÁSICAS (ponto de partida — refine conforme necessário)
-- =====================================================================

-- Perfis: cada um lê o próprio; gestor/admin leem todos.
CREATE POLICY "perfil: ler próprio ou gestão" ON public.profiles FOR SELECT
USING (id = auth.uid() OR EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gestor','admin')
));

-- Dossiês: qualquer autenticado lê e insere (captação); update por autenticados.
CREATE POLICY "dossie: ler autenticado" ON public.dossiers FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "dossie: inserir autenticado" ON public.dossiers FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "dossie: atualizar autenticado" ON public.dossiers FOR UPDATE
USING (auth.uid() IS NOT NULL);

-- Exclusão de dossiê: bloqueada para captador e terceiro.
CREATE POLICY "dossie: excluir exceto captador/terceiro" ON public.dossiers FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role NOT IN ('captador','terceiro')
));

-- Credenciais Gov: a coluna gov_password_encrypted deve ser exposta apenas a
-- papéis autorizados via VIEW/coluna mascarada ou função SECURITY DEFINER que
-- registra no activity_logs (replicar o comportamento do endpoint /reveal).
