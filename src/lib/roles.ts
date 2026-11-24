// Predicados de papel — fonte única de verdade do RBAC, sem I/O e sem
// dependência de servidor.
//
// Existe porque as regras precisam ser conhecidas nos DOIS lados: o servidor
// decide de verdade (src/lib/auth.ts + rotas em src/app/api/*), e a interface
// precisa das mesmas regras pra não mostrar um botão que vai tomar 403 no
// submit. Como src/lib/auth.ts importa `crypto`/`bcryptjs`/`NextRequest`, ele
// não pode ser importado por um componente `'use client'` — antes disso, a
// regra acabava duplicada em auth.ts e permissions.ts, com o risco real de uma
// mudar e a outra não. Este arquivo é o denominador comum: nada aqui pode
// importar nada de servidor.
//
// Regra de visibilidade (Dm, 18/11): cada papel só VÊ os módulos dele. O que
// não é do papel não aparece no menu nem na tela (nem desabilitado), e a API
// recusa. O gestor (admin) vê tudo. Matriz em "Amotex Prevent - Melhorias
// para o Fable" (Obsidian, 19/11):
//
//   Módulo          admin  secretaria                 tecnico                  sindico
//   Dashboard       sim    sim (sem financeiro)       não                      não
//   OS              todas  todas: abrir, atribuir,    só as dele + corretivas  não (vê no Painel)
//                          reagendar, cancelar        sem técnico
//   Plantão         sim    sim (monta a escala)       só vê quem está de       não
//                                                     plantão e a própria escala
//   Rotas           sim    sim + planejar             só a própria             não
//   Mapa ao vivo    sim    sim                        não                      não
//   Condomínios     sim    ver; editar contatos;      só os das suas OS        não
//                          contrato só leitura
//   Painel síndico  todos  todos                      não                      só o dele
//   Financeiro      tudo   só Cobranças (gerar,       não                      não
//                          enviada, pagamento)
//   Usuários        sim    não                        não                      não
//   Ajuda           todos  o dela                     o dele                   o dele
import type { OS, UserRole } from './db';

export const PAPEIS: UserRole[] = ['admin', 'secretaria', 'tecnico', 'sindico'];

export function isPapelValido(p: unknown): p is UserRole {
  return typeof p === 'string' && (PAPEIS as string[]).includes(p);
}

// ===== Papéis =====

// Administração de usuários e trilhas de auditoria. Gestor = admin.
export function isAdmin(role?: UserRole): boolean {
  return role === 'admin';
}

export function isSecretaria(role?: UserRole): boolean {
  return role === 'secretaria';
}

export function isTecnico(role?: UserRole): boolean {
  return role === 'tecnico';
}

// Escritório: quem enxerga a operação inteira (todas as OS, todos os
// condomínios, todas as rotas). Gestor e secretária.
export function isEscritorio(role?: UserRole): boolean {
  return role === 'admin' || role === 'secretaria';
}

// Operação de campo: checklist, fotos, assinaturas, chegada, finalizar e
// cadastro de equipamento na visita. Gestor e técnico (a secretária não vai
// a campo).
export function isAdminOrTecnico(role?: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Síndico é escopado ao próprio condomínio — quem chama precisa cruzar com o
// condominio_id do usuário (ver canAccessCondominio em src/lib/auth.ts).
export function isScopedToOwnCondominio(role?: UserRole): boolean {
  return role === 'sindico';
}

// ===== Módulos (menu + tela + API) =====

export type Modulo =
  | 'dashboard'
  | 'plantao'
  | 'os'
  | 'rotas'
  | 'mapa'
  | 'condominios'
  | 'painel'
  | 'financeiro'
  | 'usuarios'
  | 'ajuda';

const MODULOS: Record<Modulo, UserRole[]> = {
  dashboard: ['admin', 'secretaria'],
  plantao: ['admin', 'secretaria', 'tecnico'],
  os: ['admin', 'secretaria', 'tecnico'],
  rotas: ['admin', 'secretaria', 'tecnico'],
  mapa: ['admin', 'secretaria'],
  condominios: ['admin', 'secretaria', 'tecnico'],
  painel: ['admin', 'secretaria', 'sindico'],
  financeiro: ['admin', 'secretaria'],
  usuarios: ['admin'],
  ajuda: ['admin', 'secretaria', 'tecnico', 'sindico'],
};

export function podeVerModulo(role: UserRole | undefined, modulo: Modulo): boolean {
  return !!role && MODULOS[modulo].includes(role);
}

// Primeira tela depois do login (e destino de quem abre pela URL uma tela que
// não é do seu papel).
export function telaInicial(role?: UserRole): string {
  if (role === 'sindico') return '/painel';
  return '/';
}

// Rota da interface → módulo. Usado pelo AppShell para esconder a tela de
// quem não é do papel. Ordem importa: prefixo mais específico primeiro.
export function moduloDaRota(pathname: string): Modulo | null {
  if (pathname === '/') return 'os';
  const prefixos: [string, Modulo][] = [
    ['/dashboard', 'dashboard'],
    ['/plantao', 'plantao'],
    ['/rotas', 'rotas'],
    ['/mapa', 'mapa'],
    ['/condominios', 'condominios'],
    ['/painel', 'painel'],
    ['/financeiro', 'financeiro'],
    ['/admin/usuarios', 'usuarios'],
    ['/ajuda', 'ajuda'],
  ];
  for (const [p, m] of prefixos) {
    if (pathname === p || pathname.startsWith(p + '/')) return m;
  }
  return null;
}

// ===== Ações =====

// Abrir OS (Nova OS e corretiva de dentro da preventiva).
export function podeAbrirOS(role?: UserRole): boolean {
  return role === 'admin' || role === 'secretaria' || role === 'tecnico';
}

// Chamado de corretiva aberto pelo Painel do Condomínio (síndico/zelador/
// gerente do condomínio): só corretiva, só do próprio condomínio, sem escolher
// técnico, data nem prioridade. E cancelar o próprio chamado dentro da regra
// de src/lib/os-cancelamento.ts.
export function podeAbrirChamado(role?: UserRole): boolean {
  return role === 'sindico';
}
export function podeCancelarChamado(role?: UserRole): boolean {
  return role === 'sindico';
}

// "Estou a caminho": o técnico da OS (o servidor confere que a OS é dele) e o
// escritório, quando marca por ele.
export function podeMarcarACaminho(role?: UserRole): boolean {
  return isEscritorio(role) || role === 'tecnico';
}

// Localização de chegada/finalização: só o escritório vê as coordenadas.
export function podeVerLocalizacao(role?: UserRole): boolean {
  return isEscritorio(role);
}

// Atribuir técnico, reagendar, mudar prioridade e dados do chamado.
// O técnico ainda pode (até a P2 "Técnico com permissão demais nas OS"),
// mas só nas OS que ele vê.
export function podeAgendarOS(role?: UserRole): boolean {
  return role === 'admin' || role === 'secretaria' || role === 'tecnico';
}

// Trabalho de campo na OS: chegada/iniciar, checklist, fotos, assinaturas,
// finalizar. Secretária não.
export function podeOperarCampo(role?: UserRole): boolean {
  return isAdminOrTecnico(role);
}

// Cancelar OS (com confirmação). Apagar é só do gestor.
export function podeCancelarOS(role?: UserRole): boolean {
  return isEscritorio(role);
}
export function podeApagarOS(role?: UserRole): boolean {
  return isAdmin(role);
}

// Planejar as preventivas do mês (prévia + confirmação).
export function podePlanejarPreventivas(role?: UserRole): boolean {
  return isEscritorio(role);
}

// Marcar quem está de plantão e montar a escala (o técnico só consulta).
export function podeGerirPlantao(role?: UserRole): boolean {
  return isEscritorio(role);
}

// Ver a rota de qualquer técnico (o técnico só vê a própria).
export function podeVerRotaDeTodos(role?: UserRole): boolean {
  return isEscritorio(role);
}

// Condomínio: cadastro/contrato/reservatórios/apagar = gestor; contatos =
// gestor e secretária; equipamentos = gestor e técnico (cadastro em campo).
export function podeEditarCondominio(role?: UserRole): boolean {
  return isAdmin(role);
}
// Endereço e localização no mapa (24/11): a secretária também edita, sem
// tocar em identificação, contrato, responsável ou situação do contrato. O
// PATCH /api/condominios/[id] descarta os outros campos quando não é gestor.
export const CAMPOS_ENDERECO_CONDOMINIO = ['endereco', 'bairro', 'cidade', 'uf', 'cep', 'regiao', 'lat', 'lng'] as const;
export function podeEditarEnderecoCondominio(role?: UserRole): boolean {
  return isEscritorio(role);
}
export function podeEditarContato(role?: UserRole): boolean {
  return isEscritorio(role);
}
// Contato em campo: o técnico adiciona e edita (sem excluir, sem mexer no
// nível de escalonamento) nos condomínios das OS atribuídas a ele — o servidor
// confere o vínculo (src/lib/contato-acesso.ts). A tela mostra os botões só
// para quem passa por aqui.
export function podeEditarContatoEmCampo(role?: UserRole): boolean {
  return isEscritorio(role) || role === 'tecnico';
}
export function podeEditarEquipamento(role?: UserRole): boolean {
  return isAdminOrTecnico(role);
}
// Contrato (valor, vencimento, reajuste, CNPJ): gestor edita, secretária só lê.
export function podeVerContrato(role?: UserRole): boolean {
  return isEscritorio(role);
}
// Reservatórios (monitoramento por sensor) — não é do técnico nem do síndico.
export function podeVerReservatorios(role?: UserRole): boolean {
  return isEscritorio(role);
}

// Financeiro: a secretária só tem a aba Cobranças, e nela só a rotina
// (gerar o mês, marcar enviada, registrar pagamento, anexar comprovante).
// Isentar, reabrir, editar valor, ajustes, reajustes, meta e painel de
// receita: gestor.
export type AbaFinanceiro = 'painel' | 'cobrancas' | 'reajustes' | 'pendencias';
export function abasFinanceiro(role?: UserRole): AbaFinanceiro[] {
  if (role === 'admin') return ['painel', 'cobrancas', 'reajustes', 'pendencias'];
  if (role === 'secretaria') return ['cobrancas'];
  return [];
}
export const ACOES_COBRANCA_SECRETARIA = ['marcar_enviada', 'registrar_pagamento', 'anexar_comprovante', 'ajustar_vencimento'] as const;
export function podeAcaoCobranca(role: UserRole | undefined, acao: string): boolean {
  if (role === 'admin') return true;
  if (role === 'secretaria') return (ACOES_COBRANCA_SECRETARIA as readonly string[]).includes(acao);
  return false;
}

// ===== Escopo de OS =====

export function osEncerrada(os: Pick<OS, 'status'>): boolean {
  return os.status === 'finalizada' || os.status === 'cancelada';
}

// O técnico vê as OS dele e as corretivas ainda sem técnico (para assumir).
// Escritório vê todas. Síndico: por condomínio (ver podeVerOS em auth.ts,
// que precisa do condominio_id do usuário no banco).
export function tecnicoVeOS(tecnicoId: string, os: Pick<OS, 'tecnico_id' | 'tipo' | 'status'>): boolean {
  if (os.tecnico_id === tecnicoId) return true;
  return !os.tecnico_id && os.tipo === 'corretiva' && !osEncerrada(os);
}
