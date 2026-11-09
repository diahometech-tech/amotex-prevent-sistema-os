// Os nós de Telegram do n8n mandam com parse_mode Markdown (o padrão do nó,
// mesmo sem configurar). Nesse modo um "_" ou "*" solto — "bomba_2" na
// descrição do problema, um nome de condomínio — faz o Telegram recusar a
// mensagem INTEIRA ("can't parse entities"), e a corretiva urgente não chega.
// Todo texto vindo de cadastro/usuário passa por aqui antes de ir pro n8n.
export function escaparMarkdown(s: string): string {
  return s.replace(/([_*`[])/g, '\\$1');
}
