// Endereço, mapa e telefone do local — funções puras (sem I/O), usadas no
// cliente (OSModal, lista, rota) e no servidor (PDF, aviso do Telegram, API).
//
// Existe porque o técnico chega ao condomínio pelo celular: precisa do endereço
// inteiro num lugar só, de um toque pra abrir o mapa e de um toque pra ligar
// pra quem abre o portão. Antes, cada tela montava (ou ignorava) o endereço do
// seu jeito, e o cadastro tem rua, bairro, cidade/UF e CEP em campos separados.
import type { Contato, Condominio, OS } from './db';

type EnderecoFonte = Pick<Partial<Condominio>, 'endereco' | 'bairro' | 'cidade' | 'uf' | 'cep'>;

function limpo(s: string | null | undefined): string {
  return (s ?? '').trim();
}

// "Rua X, 100 - Moema, São Paulo/SP, 04000-000". Pedaço ausente some junto com
// o separador (nada de vírgula sobrando). Sem nenhum dado, devolve ''.
export function enderecoCompleto(c: EnderecoFonte | null | undefined): string {
  if (!c) return '';
  const ruaBairro = [limpo(c.endereco), limpo(c.bairro)].filter(Boolean).join(' - ');
  const cidade = limpo(c.cidade);
  const uf = limpo(c.uf);
  const cidadeUf = cidade && uf ? `${cidade}/${uf}` : cidade || uf;
  return [ruaBairro, cidadeUf, limpo(c.cep)].filter(Boolean).join(', ');
}

// Versão curta pra lista de OS: só rua + bairro (o resto é ruído na linha).
export function enderecoCurto(c: EnderecoFonte | null | undefined): string {
  if (!c) return '';
  return [limpo(c.endereco), limpo(c.bairro)].filter(Boolean).join(' - ');
}

// Link de busca do Google Maps (abre o app no celular). Sem endereço nem
// cidade não há o que buscar com segurança (só o nome do condomínio acharia
// o lugar errado): devolve null e a tela esconde o botão.
export function linkMapa(c: (EnderecoFonte & { nome?: string }) | null | undefined): string | null {
  if (!c) return null;
  if (!limpo(c.endereco) && !limpo(c.cidade)) return null;
  const consulta = enderecoCompleto(c) || limpo(c.nome);
  if (!consulta) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

// Mesmo endereço no Waze (pedido dos técnicos em 19/11: cada um usa o app de
// rota que prefere). `navigate=yes` já abre a rota em vez de só o ponto.
export function linkWaze(c: (EnderecoFonte & { nome?: string }) | null | undefined): string | null {
  if (!c) return null;
  if (!limpo(c.endereco) && !limpo(c.cidade)) return null;
  const consulta = enderecoCompleto(c) || limpo(c.nome);
  if (!consulta) return null;
  return `https://waze.com/ul?q=${encodeURIComponent(consulta)}&navigate=yes`;
}

// Converte o que a equipe digita ("+55 11 99999-8888", "11999998888",
// "(11) 9999-8888") em `tel:+55...`. Menos de 10 dígitos (sem DDD) não dá pra
// discar com segurança: null. Sem DDI, assume Brasil (55).
export function telefoneDiscavel(s: string | null | undefined): string | null {
  const bruto = limpo(s);
  if (!bruto) return null;
  const temMais = bruto.startsWith('+');
  let d = bruto.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!temMais) {
    // "011 99999-8888": o zero de tronco não entra no número internacional.
    d = d.replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    else if (!(d.startsWith('55') && (d.length === 12 || d.length === 13))) return null;
  }
  if (d.length < 10 || d.length > 15) return null;
  return `tel:+${d}`;
}

export interface TelefoneLocal {
  rotulo: 'Zelador' | 'Quem chamou' | 'Responsável';
  nome: string;
  href: string;
}

// Telegram guarda id/@usuário no identificador: só vale como telefone quando
// vem formatado com "+" (um id numérico de 10 dígitos pareceria DDD+número).
function identificadorVirouTelefone(c: Contato): string | null {
  if (c.canal_preferencial === 'email') return null;
  const id = limpo(c.identificador_canal);
  if (c.canal_preferencial === 'telegram' && !id.startsWith('+')) return null;
  return telefoneDiscavel(id);
}

// Quem ligar ao chegar, em ordem de utilidade: o zelador (quem abre o portão),
// quem abriu o chamado (só corretiva) e o responsável do cadastro. No máximo 3,
// sem repetir o mesmo número (o zelador costuma ser também o solicitante).
export function telefonesDoLocal(
  condominio: Pick<Partial<Condominio>, 'responsavel_nome' | 'responsavel_telefone'> | null | undefined,
  contatos: Contato[] | null | undefined,
  os?: Pick<OS, 'tipo' | 'solicitante_nome' | 'solicitante_telefone'> | null
): TelefoneLocal[] {
  const lista: TelefoneLocal[] = [];
  const vistos = new Set<string>();
  const add = (rotulo: TelefoneLocal['rotulo'], nome: string | undefined, href: string | null) => {
    if (!href || vistos.has(href) || lista.length >= 3) return;
    vistos.add(href);
    lista.push({ rotulo, nome: limpo(nome), href });
  };

  // WhatsApp primeiro: é o canal em que o identificador é de fato um telefone.
  const zeladores = (contatos ?? []).filter((c) => c.papel === 'zelador' && c.ativo !== false);
  zeladores.sort((a, b) => Number(b.canal_preferencial === 'whatsapp') - Number(a.canal_preferencial === 'whatsapp'));
  for (const z of zeladores) add('Zelador', z.nome, identificadorVirouTelefone(z));

  if (os && os.tipo === 'corretiva') add('Quem chamou', os.solicitante_nome, telefoneDiscavel(os.solicitante_telefone));
  add('Responsável', condominio?.responsavel_nome, telefoneDiscavel(condominio?.responsavel_telefone));
  return lista;
}
