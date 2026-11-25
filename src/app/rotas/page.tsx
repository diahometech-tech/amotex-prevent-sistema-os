'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Form';
import { OSModal } from '@/components/os/OSModal';
import { PlanejarPreventivas } from '@/components/os/PlanejarPreventivas';
import { PainelPreventivasMes } from '@/components/os/PainelPreventivasMes';
import { ReorganizarRotas } from '@/components/os/ReorganizarRotas';
import { Modal } from '@/components/ui/Modal';
import { podeOperarCampo, podePlanejarPreventivas, podeVerRotaDeTodos } from '@/lib/roles';
import { computeOsPrioridade, resumoRotasPorCondominio, OS_STATUS_LABELS, type RotaCondominio } from '@/lib/os-priority';
import { ehDiaUtil, formatarDataCurta, hojeISO, montarRotaDoDia, somarDias } from '@/lib/os-agenda';
import { slaChegada, textoChegada } from '@/lib/os-sla';
import { preventivaAberta } from '@/lib/reorganizar-fila';
import { enfileirar, ouvirFila } from '@/lib/fila-envio';
import { useFilaEnvio } from '@/lib/useFilaEnvio';
import { useTick } from '@/lib/useTick';
import { BotaoLigar, BotoesMapa } from '@/components/os/LocalDoCondominio';
import { enderecoCompleto, linkMapa, linkWaze, type TelefoneLocal } from '@/lib/endereco';
import type { Condominio, OS } from '@/lib/db';
import { Icon } from '@/components/ui/Icon';
import { compararGeografico, REGIOES } from '@/lib/regioes';

// GET /api/condominios devolve também o telefone pra ligar ao chegar.
type CondominioRota = Condominio & { contato_local?: TelefoneLocal | null };

interface TecnicoLite {
  id: string;
  nome: string;
}

// Filtro de técnico: '' = todos; SEM_TECNICO = só as não atribuídas; senão o id.
const SEM_TECNICO = 'sem_tecnico';
// Filtro de região (só escritório): '' = todas; SEM_REGIAO = condomínio sem região; senão a região.
const SEM_REGIAO = 'sem_regiao';

type GrupoNomeado = RotaCondominio & { nome: string };

function RotasContent() {
  const user = useAmxUser();
  useTick(); // prazo de chegada das corretivas anda sozinho na rota

  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<CondominioRota[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visitando, setVisitando] = useState<string | null>(null);
  // Chegadas registradas sem sinal, ainda na fila do aparelho.
  const fila = useFilaEnvio();
  const chegadaPendente = (osId: string) => fila.flatMap((i) => (i.tipo === 'chegada' && i.os_id === osId && !i.recusado ? [i] : []))[0];
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);
  const [showPlanejar, setShowPlanejar] = useState(false);
  const [showReorganizar, setShowReorganizar] = useState(false);

  const hoje = hojeISO();
  const [dia, setDia] = useState(hoje);
  // Escritório vê a equipe toda e filtra por técnico; técnico só tem a própria rota. (O AppShell
  // só monta esta tela depois de carregar o usuário, então `user` já existe.)
  const [filtroTecnico, setFiltroTecnico] = useState('');
  const [filtroRegiao, setFiltroRegiao] = useState('');

  const condominioNome = useMemo(() => {
    const map = new Map(condominios.map((c) => [c.id, c.nome]));
    return (id: string) => map.get(id) || 'Condomínio desconhecido';
  }, [condominios]);
  const condominioPorId = useMemo(() => new Map(condominios.map((c) => [c.id, c])), [condominios]);

  const tecnicoNome = useMemo(() => {
    const map = new Map(tecnicos.map((t) => [t.id, t.nome]));
    return (id?: string) => (id ? map.get(id) : undefined);
  }, [tecnicos]);

  const load = async () => {
    try {
      const [osRes, condRes, userRes] = await Promise.all([
        fetch('/api/os', { cache: 'no-store' }),
        fetch('/api/condominios', { cache: 'no-store' }),
        fetch('/api/users', { cache: 'no-store' }).catch(() => null),
      ]);
      if (osRes.ok) {
        const data = await osRes.json();
        setOss(data.oss ?? []);
      } else {
        const data = await osRes.json().catch(() => ({}));
        setError(data.error || 'Não foi possível carregar as rotas.');
      }
      if (condRes.ok) setCondominios((await condRes.json()).condominios ?? []);
      if (userRes?.ok) {
        const data = await userRes.json();
        const users: { id: string; nome: string; papel?: string }[] = data.users || [];
        // GET /api/users devolve dois formatos: admin recebe a lista completa
        // (com `papel`), técnico recebe um payload reduzido `{id, nome}` que
        // JÁ vem só com técnicos ativos. Filtrar por `papel === 'tecnico'`
        // zerava a lista inteira pro técnico (o campo nem existe no payload
        // dele) — daí aceitar também quem chega sem `papel`.
        setTecnicos(users.filter((u) => u.papel === undefined || u.papel === 'tecnico'));
      }
    } catch {
      setError('Erro de conexão ao carregar as rotas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Mesmo padrão de src/app/page.tsx: load() só faz setState depois do
    // primeiro await, mas o lint não segue a função até lá.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  // Chegada que subiu da fila entra na lista sem recarregar.
  useEffect(
    () =>
      ouvirFila((e) => {
        if (e.tipo === 'chegada_enviada') setOss((prev) => prev.map((o) => (o.id === e.os.id ? e.os : o)));
      }),
    []
  );

  const verTodos = podeVerRotaDeTodos(user?.role);

  const doTecnico = useMemo(() => {
    // Técnico só tem a própria rota: a lista dele traz também corretivas sem
    // técnico (pra assumir), que ficam na tela de OS, não aqui.
    if (!verTodos) return oss.filter((o) => o.tecnico_id === user?.id);
    let lista = oss;
    if (filtroTecnico) lista = filtroTecnico === SEM_TECNICO ? lista.filter((o) => !o.tecnico_id) : lista.filter((o) => o.tecnico_id === filtroTecnico);
    if (filtroRegiao) {
      const regiaoDe = (o: OS) => condominioPorId.get(o.condominio_id)?.regiao ?? '';
      lista = lista.filter((o) => (filtroRegiao === SEM_REGIAO ? !regiaoDe(o) : regiaoDe(o) === filtroRegiao));
    }
    return lista;
  }, [oss, filtroTecnico, filtroRegiao, condominioPorId, verTodos, user?.id]);

  const rota = useMemo(() => montarRotaDoDia(doTecnico, dia, hoje), [doTecnico, dia, hoje]);

  // Atrasadas entram junto na rota do dia (é trabalho pra hoje), marcadas
  // na linha. Contagem e ordem saem de resumoRotasPorCondominio — a mesma
  // função dos badges (ver o aviso em src/lib/os-priority.ts).
  // A rota sai por região e CEP (o que fica perto fica junto); condomínio sem
  // região vai por último. Só o chamado urgente sobe pro topo: tem prazo de 3h.
  const gruposDoDia = useMemo(
    () => ordenarPorRegiao(nomear(resumoRotasPorCondominio([...rota.doDia, ...rota.atrasadas]), condominioNome), condominioPorId),
    [rota, condominioNome, condominioPorId]
  );
  const gruposSemData = useMemo(
    () => ordenarPorRegiao(nomear(resumoRotasPorCondominio(rota.semData), condominioNome), condominioPorId),
    [rota, condominioNome, condominioPorId]
  );

  // "X de Y feitas": só quando a rota é de UM técnico (a dele, ou o filtro do
  // escritório). Y = visitas agendadas pro dia, X = as finalizadas.
  const tecnicoDaRota = !verTodos ? user?.id : filtroTecnico && filtroTecnico !== SEM_TECNICO ? filtroTecnico : undefined;
  const progresso = useMemo(() => {
    if (!tecnicoDaRota) return null;
    const doDia = oss.filter((o) => o.tecnico_id === tecnicoDaRota && o.data_programada === dia && o.status !== 'cancelada');
    return { feitas: doDia.filter((o) => o.status === 'finalizada').length, total: doDia.length };
  }, [oss, tecnicoDaRota, dia]);

  // Terminou tudo (técnico, dia útil, tinha visita hoje e fez todas): as 3
  // próximas preventivas dele, só do mês corrente, pra adiantar. Fim de semana
  // (plantão) e dia sem visita não oferecem.
  const terminouTudo =
    !verTodos && dia === hoje && ehDiaUtil(hoje) && rota.doDia.length === 0 && rota.atrasadas.length === 0 &&
    !!progresso && progresso.total > 0 && progresso.feitas === progresso.total;
  const gruposAdiantar = useMemo(() => {
    if (!terminouTudo) return [];
    const proximas = doTecnico
      .filter((o) => preventivaAberta(o) && !!o.data_programada && o.data_programada > hoje && o.data_programada.slice(0, 7) === hoje.slice(0, 7))
      .sort((a, b) => a.data_programada!.localeCompare(b.data_programada!) || a.id.localeCompare(b.id))
      .slice(0, 3);
    return ordenarPorRegiao(nomear(resumoRotasPorCondominio(proximas), condominioNome), condominioPorId);
  }, [terminouTudo, doTecnico, hoje, condominioNome, condominioPorId]);

  const totalDoDia = rota.doDia.length + rota.atrasadas.length;
  const totalUrgentes = gruposDoDia.reduce((acc, g) => acc + g.urgentes, 0);

  const marcarVisitado = async (os: OS) => {
    setVisitando(os.id);
    // Limpa o erro da tentativa anterior: sem isso o banner de "Falha ao
    // marcar visita" continuava na tela mesmo depois de um retry que deu certo.
    setError('');
    // O servidor grava a hora da chegada; só sem sinal vai a hora do aparelho, pela fila.
    const horaDoToque = new Date().toISOString();
    try {
      const res = await fetch(`/api/os/${os.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'em_andamento' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOss((prev) => prev.map((o) => (o.id === data.os.id ? data.os : o)));
      } else {
        setError(data.error || 'Falha ao registrar a chegada.');
      }
    } catch {
      try {
        await enfileirar({ tipo: 'chegada', os_id: os.id, entrada_em: horaDoToque });
      } catch {
        setError('Não foi possível registrar a chegada. Tente de novo.');
      }
    } finally {
      setVisitando(null);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const minhaRota = !verTodos;
  const tituloDia = dia === hoje ? 'hoje' : formatarDataCurta(dia);

  const renderGrupo = (g: GrupoNomeado) => {
    const cond = condominioPorId.get(g.condominio_id);
    const local = cond
      ? { endereco: enderecoCompleto(cond), mapa: linkMapa(cond), waze: linkWaze(cond), ligar: cond.contato_local ?? null }
      : null;
    return (
    <Card key={g.condominio_id}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{g.nome}</p>
          {cond?.regiao && (
            <p className="text-[11px] font-semibold text-amx-blue-light">
              {cond.regiao}{cond.cep ? ` · CEP ${cond.cep}` : ''}
            </p>
          )}
          {local?.endereco && <p className="text-xs text-amx-muted select-text">{local.endereco}</p>}
          {(local?.mapa || local?.ligar) && (
            <div className="flex flex-wrap gap-2 mt-2">
              <BotoesMapa google={local.mapa} waze={local.waze} />
              {local.ligar && <BotaoLigar item={local.ligar} />}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone="neutral">{g.total} OS</Badge>
          {g.urgentes > 0 && <Badge tone="red">{g.urgentes} urgente{g.urgentes > 1 ? 's' : ''}</Badge>}
          {g.altas > 0 && <Badge tone="warning">{g.altas} alta{g.altas > 1 ? 's' : ''}</Badge>}
        </div>
      </div>
      <div className="space-y-2">
        {g.oss.map((os) => {
          const prioridade = computeOsPrioridade(os);
          const atrasada = os.tipo === 'preventiva' && !!os.data_programada && os.data_programada < dia;
          const sla = slaChegada(os);
          return (
            <div
              key={os.id}
              className="flex items-center gap-3 bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5 flex-wrap"
            >
              <button
                type="button"
                onClick={() => setSelectedOsId(os.id)}
                className="flex items-center gap-3 flex-1 basis-60 min-w-0 text-left"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${prioridade.nivel === 'urgente' || prioridade.nivel === 'alta' ? 'bg-amx-red' : 'bg-amx-blue'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">
                    {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                    {(os.descricao_problema || os.observacao) && ` · ${os.descricao_problema || os.observacao}`}
                  </p>
                  <p className="text-[11px] text-amx-muted truncate">
                    {OS_STATUS_LABELS[os.status]} · aberta há {prioridade.elapsedLabel}
                    {/* Sem cair pro id: o fallback anterior passava o
                        UUID do técnico pela função de iniciais e
                        exibia uma letra sem sentido na tela. */}
                    {os.tecnico_id ? ` · ${tecnicoNome(os.tecnico_id) ?? 'técnico atribuído'}` : ' · não atribuído'}
                  </p>
                  {sla && sla.situacao !== 'cumprido' && (
                    <p className={`text-[11px] font-semibold ${sla.tone === 'red' ? 'text-amx-red-hover' : 'text-amx-amber'}`}>
                      <span className="inline-flex items-center gap-1"><Icon name="relogio" size={12} />{sla.label}</span>
                    </p>
                  )}
                  {os.data_programada && os.data_programada > dia && (
                    <p className="text-[11px] font-semibold text-amx-blue">
                      Programada para {formatarDataCurta(os.data_programada)} · pode adiantar
                    </p>
                  )}
                  {atrasada && (
                    <p className="text-[11px] font-semibold text-amx-amber">
                      Atrasada · era para {formatarDataCurta(os.data_programada!)}
                    </p>
                  )}
                </div>
                <Badge tone={prioridade.nivel === 'urgente' ? 'red' : prioridade.nivel === 'alta' ? 'warning' : 'info'}>
                  {prioridade.label}
                </Badge>
              </button>
              {os.entrada_em ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-green">
                  <Icon name="check" size={14} />
                  {textoChegada(os.entrada_em)}
                </span>
              ) : chegadaPendente(os.id) ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-amber">
                  <Icon name="nuvemEnvio" size={14} />
                  {textoChegada(chegadaPendente(os.id)!.entrada_em)} (aguardando envio)
                </span>
              ) : podeOperarCampo(user?.role) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={visitando === os.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    marcarVisitado(os);
                  }}
                >
                  <Icon name="mapa" size={14} />
                  {visitando === os.id ? 'Registrando...' : 'Cheguei no local'}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">
          {minhaRota ? `Minha rota de ${tituloDia}` : `Rota de ${tituloDia}`}
        </h1>
        <p className="text-[13px] text-amx-muted mt-1">
          {totalDoDia} OS em {gruposDoDia.length} condomínio{gruposDoDia.length !== 1 ? 's' : ''}
          {rota.atrasadas.length > 0 ? ` · ${rota.atrasadas.length} atrasada${rota.atrasadas.length > 1 ? 's' : ''}` : ''}
          {totalUrgentes > 0 ? ` · ${totalUrgentes} urgente${totalUrgentes > 1 ? 's' : ''}` : ''}
          {progresso && progresso.total > 0 ? ` · ${progresso.feitas} de ${progresso.total} feitas${dia === hoje ? ' hoje' : ''}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior">
            ‹
          </Button>
          <Input
            id="rota-dia"
            type="date"
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            className="w-auto max-w-full min-w-0 py-1.5 text-xs"
          />
          <Button variant="secondary" size="sm" onClick={() => setDia(somarDias(dia, 1))} aria-label="Próximo dia">
            ›
          </Button>
          {dia !== hoje && (
            <Button variant="secondary" size="sm" onClick={() => setDia(hoje)}>
              Hoje
            </Button>
          )}
          {verTodos && (
            <Select
              id="rota-tecnico"
              value={filtroTecnico}
              onChange={(e) => setFiltroTecnico(e.target.value)}
              className="w-auto max-w-full min-w-0 py-1.5 text-xs"
            >
              <option value="">Todos os técnicos</option>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
              <option value={SEM_TECNICO}>Não atribuídas</option>
            </Select>
          )}
          {verTodos && (
            <Select
              id="rota-regiao"
              aria-label="Filtrar por região"
              value={filtroRegiao}
              onChange={(e) => setFiltroRegiao(e.target.value)}
              className="w-auto max-w-full min-w-0 py-1.5 text-xs"
            >
              <option value="">Todas as regiões</option>
              {REGIOES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value={SEM_REGIAO}>Sem região</option>
            </Select>
          )}
          {podePlanejarPreventivas(user.role) && (
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button size="sm" variant="secondary" onClick={() => setShowReorganizar(true)}>
                Reorganizar agora
              </Button>
              <Button size="sm" onClick={() => setShowPlanejar(true)}>
                Planejar preventivas do mês
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        {error && (
          <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {podePlanejarPreventivas(user.role) && <PainelPreventivasMes oss={oss} tecnicoNome={tecnicoNome} hoje={hoje} ehGestor={user.role === 'admin'} />}

        {gruposDoDia.length === 0 ? (
          progresso && progresso.total > 0 ? (
            <EmptyState
              title={`Tudo feito para ${tituloDia}`}
              description={`${progresso.feitas} de ${progresso.total} visita${progresso.total > 1 ? 's' : ''} concluída${progresso.feitas > 1 ? 's' : ''}.`}
            />
          ) : (
            <EmptyState
              title={`Nenhuma visita para ${tituloDia}`}
              description="Agende OS para este dia pelo campo 'Data da visita', na criação ou no detalhe da OS."
            />
          )
        ) : (
          <div className="space-y-5">{gruposDoDia.map(renderGrupo)}</div>
        )}

        {gruposAdiantar.length > 0 && (
          <div className="mt-8">
            <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted mb-3">
              ADIANTAR: PRÓXIMAS VISITAS · pode abrir e fazer; ao chegar, a visita passa a ser de hoje
            </p>
            <div className="space-y-5">{gruposAdiantar.map(renderGrupo)}</div>
          </div>
        )}

        {gruposSemData.length > 0 && (
          <div className="mt-8">
            <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted mb-3">
              SEM DATA DE VISITA · {rota.semData.length} OS · abra a OS e defina o dia
            </p>
            <div className="space-y-5">{gruposSemData.map(renderGrupo)}</div>
          </div>
        )}
      </div>

      <Modal open={showPlanejar} onClose={() => setShowPlanejar(false)} maxWidth="max-w-2xl">
        {showPlanejar && <PlanejarPreventivas onClose={() => setShowPlanejar(false)} onCriado={load} />}
      </Modal>

      <Modal open={showReorganizar} onClose={() => setShowReorganizar(false)} maxWidth="max-w-2xl">
        {showReorganizar && <ReorganizarRotas onClose={() => setShowReorganizar(false)} onAplicado={load} />}
      </Modal>

      {selectedOsId && (
        <OSModal
          key={selectedOsId}
          osId={selectedOsId}
          condominioNome={oss.find((o) => o.id === selectedOsId) ? condominioNome(oss.find((o) => o.id === selectedOsId)!.condominio_id) : ''}
          onClose={() => setSelectedOsId(null)}
          onChanged={(updated) => {
            setOss((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
          }}
          onDeleted={(id) => setOss((prev) => prev.filter((o) => o.id !== id))}
        />
      )}
    </div>
  );
}

function nomear(grupos: RotaCondominio[], condominioNome: (id: string) => string): GrupoNomeado[] {
  return grupos.map((g) => ({ ...g, nome: condominioNome(g.condominio_id) }));
}

// Região e CEP; sem região no fim. Chamado urgente (corretiva, 3h para chegar)
// vem antes, e dentro de cada bloco vale a ordem por região.
function ordenarPorRegiao(grupos: GrupoNomeado[], condominios: Map<string, CondominioRota>): GrupoNomeado[] {
  const ponto = (g: GrupoNomeado) => {
    const c = condominios.get(g.condominio_id);
    return { nome: g.nome, regiao: c?.regiao, cep: c?.cep };
  };
  return [...grupos].sort((a, b) => Number(b.urgentes > 0) - Number(a.urgentes > 0) || compararGeografico(ponto(a), ponto(b)));
}

export default function RotasPage() {
  return (
    <AppShell>
      <RotasContent />
    </AppShell>
  );
}
