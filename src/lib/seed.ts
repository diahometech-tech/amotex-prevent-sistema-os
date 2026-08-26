// Dados de demonstração do NexusFlow.
// Usado para popular o banco local automaticamente quando está vazio (apenas em dev).
import type { Dossier, ActivityLog } from './db';
import { encrypt } from './crypto';

const enc = (s: string) => encrypt(s);

export function demoSeed(): { dossiers: Dossier[]; logs: ActivityLog[] } {
  const now = Date.now();
  const iso = (hAgo: number) => new Date(now - hAgo * 3600 * 1000).toISOString();
  const sla = (hAhead: number) => new Date(now + hAhead * 3600 * 1000).toISOString();

  const dossiers: Dossier[] = [
    {
      id: 'A1B2C3', client_name: 'Maria Aparecida Silva', cpf: '123.456.789-09',
      phone: '(11) 98877-1122', email: 'maria.silva@email.com',
      address: 'Rua das Acácias, 245 - Vila Mariana, São Paulo/SP',
      gov_level: 'ouro', gov_login: 'maria.silva@gov.br', gov_password_encrypted: enc('Gov@2026!ms'),
      status: 'captado', current_step: 'captacao', empresa_aberta: false,
      photo_doc_frente_url: '', photo_doc_verso_url: '',
      sla_deadline: sla(45), created_at: iso(3), updated_at: iso(3),
    },
    {
      id: 'D4E5F6', client_name: 'João Pedro Ferreira', cpf: '987.654.321-00',
      phone: '(11) 99654-7788', email: 'joao.ferreira@email.com', address: '',
      gov_level: 'prata', gov_login: 'joao.ferreira@gov.br', gov_password_encrypted: enc('Jpf#senhaForte9'),
      status: 't1_pendente', current_step: 't1', empresa_aberta: false,
      sla_deadline: sla(18), created_at: iso(30), updated_at: iso(6),
    },
    {
      id: 'G7H8I9', client_name: 'Rafael Oliveira Lima', cpf: '321.654.987-11',
      phone: '(31) 99001-2233', email: 'rafael.lima@email.com', address: '',
      gov_level: 'prata', gov_login: 'rafael.lima@gov.br', gov_password_encrypted: enc('Rol@forte321'),
      status: 't1_pendente', current_step: 't1', empresa_aberta: false,
      sla_deadline: sla(-4), created_at: iso(52), updated_at: iso(50),
    },
    {
      id: 'J1K2L3', client_name: 'Carla Mendes Souza', cpf: '456.789.123-77',
      phone: '(21) 98123-4455', email: 'carla.souza@email.com',
      address: 'Rua do Comércio, 88 - Centro, Rio de Janeiro/RJ',
      gov_level: 'ouro', gov_login: 'carla.souza@gov.br', gov_password_encrypted: enc('Cms!2026abc'),
      status: 't2_pendente', current_step: 't2', empresa_aberta: false,
      t1_justification: 'Sem restrições. Aprovado.',
      sla_deadline: sla(20), created_at: iso(48), updated_at: iso(10),
    },
    {
      id: 'M4N5O6', client_name: 'Bruno Carvalho Dias', cpf: '753.951.852-33',
      phone: '(41) 99876-1100', email: 'bruno.dias@email.com',
      address: 'Rua XV de Novembro, 300 - Centro, Curitiba/PR',
      gov_level: 'prata', gov_login: 'bruno.dias@gov.br', gov_password_encrypted: enc('Bcd!senha753'),
      status: 't3_bird_id', current_step: 't3', empresa_aberta: false,
      t1_justification: 'Gov Prata. Encaminhado p/ BIRD ID.',
      t2_new_email: 'bruno.empresa@nexus.com', t2_new_phone: '(41) 90000-1111',
      sla_deadline: sla(-2), created_at: iso(72), updated_at: iso(26),
    },
    {
      id: 'P7Q8R9', client_name: 'Patrícia Gomes Almeida', cpf: '159.357.486-22',
      phone: '(11) 98555-6677', email: 'patricia.almeida@email.com',
      address: 'Av. Paulista, 2000 - Bela Vista, São Paulo/SP',
      gov_level: 'ouro', gov_login: 'patricia.almeida@gov.br', gov_password_encrypted: enc('Pga#2026secure'),
      status: 't3_abertura', current_step: 't3', empresa_aberta: false,
      t1_justification: 'Gov Ouro. Abertura em andamento.',
      t2_new_email: 'patricia.empresa@nexus.com', t2_new_phone: '(11) 90000-2222',
      sla_deadline: sla(15), created_at: iso(60), updated_at: iso(5),
    },
    {
      id: 'S1T2U3', client_name: 'Fernanda Ribeiro Castro', cpf: '852.456.159-44',
      phone: '(51) 98321-9988', email: 'fernanda.castro@email.com',
      address: 'Av. Ipiranga, 450 - Centro, Porto Alegre/RS',
      gov_level: 'ouro', gov_login: 'fernanda.castro@gov.br', gov_password_encrypted: enc('Frc#2026forte'),
      status: 'finalizado', current_step: 'finalizado', empresa_aberta: true,
      t1_justification: 'Gov Ouro. Empresa aberta.',
      t2_new_email: 'fernanda.empresa@nexus.com', t2_new_phone: '(51) 90000-3333',
      certificado_a1_url: '/uploads/A1_fernanda.pfx', cnpj_number: '54.321.987/0001-10',
      sla_deadline: sla(-30), created_at: iso(120), updated_at: iso(40),
    },
  ];

  const L = (
    dossier_id: string, user_name: string, action_type: string, details: string, hAgo: number,
  ): ActivityLog => ({
    id: Math.random().toString(36).substring(2, 11).toUpperCase(),
    dossier_id, user_name, action_type, details, created_at: iso(hAgo),
  });

  const logs: ActivityLog[] = [
    L('S1T2U3', 'Léo (Certificação)', 'COMPANY_OPENED', 'Finalizou a abertura. Empresa marcada como ABERTA.', 40),
    L('S1T2U3', 'Léo (Certificação)', 'CNPJ_LINKED', 'Vinculou CNPJ 54.321.987/0001-10 ao Dossiê.', 41),
    L('D4E5F6', 'Sistema NexusFlow', 'OS_CREATED', 'Ordem de Serviço gerada via Captação. Fluxo inicial: T1 (Prata).', 30),
    L('A1B2C3', 'Sistema NexusFlow', 'OS_CREATED', 'Ordem de Serviço gerada via Captação. Fluxo inicial: Captação (Ouro).', 3),
  ];

  return { dossiers, logs };
}
