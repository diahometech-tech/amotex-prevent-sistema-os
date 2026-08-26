import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, isFieldRole } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';

export async function GET(request: NextRequest) {
  // Listagem exige sessão válida (dados de clientes).
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  // Captador só acessa a tela de cadastro; terceiro usa a projeção própria
  // (/api/terceiro/dossiers). A UI já redireciona, mas o endpoint também nega
  // (defesa em profundidade — não expor a esteira completa a esses papéis).
  if (isFieldRole(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }
  try {
    const dossiers = await Database.getDossiers();

    // Filtra por papel — replica a visibilidade de stepsForRole/canSeeStep do
    // client (src/app/page.tsx), que hoje é feita só no front (o servidor
    // devolvia a esteira inteira pra qualquer papel interno). Gestor/admin
    // continuam vendo tudo (isManager no client).
    //
    // operador_abertura: stepsForRole = ['t3','finalizado'] — só isso.
    //
    // operador_certificacao: stepsForRole do client também é ['t3','finalizado'],
    // mas a tela dedicada "Certificação" (getCertColumnDossiers em page.tsx)
    // lê o array cru e inclui OS ainda em T2 (fila do BIRD ID/SYNC do nível
    // Prata entra desde a E2 — ver skill "Fila do certificador"). Filtrar só
    // por t3/finalizado aqui quebraria essa tela. Mantido mais permissivo
    // (t2+t3+finalizado) de propósito — se stepsForRole mudar no client,
    // revisar aqui também.
    // operador_abertura: dentro de "finalizado", o client só mostra ao operador
    // as OS que ele mesmo abriu (resp_abertura === currentOperator — ver
    // page.tsx linha ~2107, coluna "Abertas/Concluídas"). "t3" continua visível
    // por inteiro (é a fila de trabalho, incluindo OS ainda livres).
    let visible = dossiers;
    if (session.role === 'operador_abertura') {
      visible = dossiers.filter((d) =>
        d.current_step === 't3' ||
        (d.current_step === 'finalizado' && d.resp_abertura === session.name)
      );
    } else if (session.role === 'operador_certificacao') {
      visible = dossiers.filter((d) => d.current_step === 't2' || d.current_step === 't3' || d.current_step === 'finalizado');
    }
    // admin: sem filtro adicional (acesso irrestrito).
    // gestor: irrestrito por padrão, MAS uma conta pode ser escopada a um ou
    // mais projetos (User.gestor_projetos, isolamento entre gestores de
    // clientes/projetos diferentes — ver src/lib/gestor-scope.ts). Só filtra
    // se a conta tiver escopo definido.
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (escopo.length > 0) {
        visible = visible.filter((d) => dossierInGestorScope(d, escopo));
      }
    }

    // Proteger dados sensíveis na consulta em lote (segurança por design!) —
    // nenhum campo *_encrypted sai daqui, só as flags has_* computadas (mesmo
    // padrão do GET de detalhe e da listagem do terceiro).
    const safeDossiers = visible.map(d => {
      const { gov_password_encrypted, cert_email_senha_encrypted, cert_senha_acesso_encrypted, t2_new_email_senha_encrypted, ...safe } = d;
      return {
        ...safe,
        has_gov_password: !!gov_password_encrypted,
        has_cert_email_senha: !!cert_email_senha_encrypted,
        has_cert_senha_acesso: !!cert_senha_acesso_encrypted,
        has_t2_new_email_senha: !!t2_new_email_senha_encrypted,
      };
    });

    return NextResponse.json(safeDossiers);
  } catch (e) {
    console.error('Erro ao listar dossiês:', e);
    return NextResponse.json({ error: 'Erro interno ao buscar dossiês.' }, { status: 500 });
  }
}
