'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Form';
import { mensagemSemCanalDeAviso } from '@/lib/plantao';
import { DIAS_SEMANA_NOME, formatarInstante, isoParaLocal, localParaIso } from '@/lib/plantao-escala';
import { podeGerirPlantao } from '@/lib/roles';
import type { UserRole } from '@/lib/db';

interface Periodo {
  id: string;
  usuario_id: string;
  usuario_nome: string;
  inicio: string;
  fim: string;
  em_andamento: boolean;
}

interface Plantonista {
  id: string;
  nome: string;
  ate: string | null;
  sem_canal?: boolean;
}

interface Tecnico {
  id: string;
  nome: string;
  sem_canal: boolean;
}

interface Dados {
  agora: { origem: 'escala' | 'manual'; periodo: 'comercial' | 'plantao'; plantonistas: Plantonista[] };
  periodos: Periodo[];
  tecnicos?: Tecnico[];
}

interface PeriodoPrevia {
  usuario_id: string;
  usuario_nome: string;
  inicio: string;
  fim: string;
}

async function chamar(url: string, metodo: string, corpo?: unknown): Promise<{ ok: boolean; dados: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const dados = await res.json().catch(() => ({}));
    return { ok: res.ok, dados };
  } catch {
    return { ok: false, dados: { error: 'Erro de conexão. Tente de novo.' } };
  }
}

// Tela "Escala de plantão". Escritório (gestor e secretária) monta a escala:
// períodos soltos e rodízio. O técnico só vê quem está de plantão agora e a
// própria escala. Quem manda é plantonistasEm (src/lib/plantao.ts).
export function EscalaPlantao({ papel }: { papel: UserRole }) {
  const editar = podeGerirPlantao(papel);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const res = await fetch('/api/plantao', { cache: 'no-store' }).catch(() => null);
    const d = res?.ok ? await res.json().catch(() => null) : null;
    if (!d) {
      setErro('Não foi possível carregar a escala.');
      return;
    }
    setErro('');
    setDados(d);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar só faz setState depois do fetch
    carregar();
  }, [carregar]);

  if (!dados) {
    return erro ? (
      <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>
    ) : (
      <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <AgoraCard agora={dados.agora} />
      <ListaPeriodos dados={dados} editar={editar} onMudou={carregar} />
      {editar && dados.tecnicos && (
        <>
          <AdicionarPeriodo tecnicos={dados.tecnicos} onMudou={carregar} />
          <GerarRodizio tecnicos={dados.tecnicos} onMudou={carregar} />
        </>
      )}
    </div>
  );
}

function AgoraCard({ agora }: { agora: Dados['agora'] }) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Plantão agora</p>
      {agora.plantonistas.length === 0 ? (
        <p className="text-sm text-white">Ninguém marcado. O aviso de corretiva vai para todos os técnicos.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agora.plantonistas.map((p) => (
            <li key={p.id} className="flex items-center gap-2 flex-wrap text-sm text-white">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amx-green" />
              <span className="font-semibold">{p.nome}</span>
              <span className="text-xs text-amx-muted">
                {agora.origem === 'escala' && p.ate ? `pela escala, até ${formatarInstante(p.ate)}` : 'marcado à mão'}
              </span>
              {p.sem_canal && <Badge tone="warning">sem Telegram nem app</Badge>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-amx-muted">
        {agora.periodo === 'comercial'
          ? 'Agora é horário comercial (seg–sex 8h–18h, sáb 8h–16h): o aviso vai para todos os técnicos de corretiva. A escala vale fora desse horário.'
          : 'Fora do horário comercial: o aviso de corretiva vai para quem está de plantão.'}
      </p>
    </Card>
  );
}

function ListaPeriodos({ dados, editar, onMudou }: { dados: Dados; editar: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<Periodo | null>(null);
  const [erro, setErro] = useState('');

  const titulo = editar ? 'Próximas semanas' : 'Minha escala';
  return (
    <Card className="p-4 flex flex-col gap-3">
      <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">{titulo}</p>
      {dados.periodos.length === 0 ? (
        <p className="text-sm text-amx-muted">
          {editar ? 'Nenhum período na escala. Adicione um período ou gere um rodízio abaixo.' : 'Você não está na escala dos próximos dias.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dados.periodos.map((p) => (
            <li key={p.id} className="bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5 flex flex-col gap-2">
              {editando === p.id ? (
                <EditarPeriodo
                  periodo={p}
                  tecnicos={dados.tecnicos ?? []}
                  onCancelar={() => setEditando(null)}
                  onSalvo={() => {
                    setEditando(null);
                    onMudou();
                  }}
                />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {editar && <span className="text-sm font-semibold text-white">{p.usuario_nome}</span>}
                    {p.em_andamento && <Badge tone="success">Em andamento</Badge>}
                  </div>
                  <p className="text-xs text-amx-muted">
                    {formatarInstante(p.inicio)} até {formatarInstante(p.fim)}
                  </p>
                  {editar && (
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="secondary" onClick={() => setEditando(p.id)}>
                        {p.em_andamento ? 'Mudar o fim' : 'Editar'}
                      </Button>
                      {!p.em_andamento && (
                        <Button size="sm" variant="danger" onClick={() => setExcluir(p)}>
                          Excluir
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
      <ConfirmDialog
        open={!!excluir}
        titulo="Excluir período"
        confirmarLabel="Excluir"
        perigo
        onConfirm={async () => {
          if (!excluir) return;
          const r = await chamar(`/api/plantao/${excluir.id}`, 'DELETE');
          if (!r.ok) return String(r.dados.error ?? 'Não foi possível excluir.');
          setExcluir(null);
          setErro('');
          onMudou();
        }}
        onClose={() => setExcluir(null)}
      >
        {excluir && (
          <p>
            Tirar {excluir.usuario_nome} do plantão de {formatarInstante(excluir.inicio)} até {formatarInstante(excluir.fim)}?
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function EditarPeriodo({
  periodo, tecnicos, onCancelar, onSalvo,
}: { periodo: Periodo; tecnicos: Tecnico[]; onCancelar: () => void; onSalvo: () => void }) {
  const [usuario, setUsuario] = useState(periodo.usuario_id);
  const [inicio, setInicio] = useState(isoParaLocal(periodo.inicio));
  const [fim, setFim] = useState(isoParaLocal(periodo.fim));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const salvar = async () => {
    setBusy(true);
    setErro('');
    // Já começou: só o fim muda.
    const corpo = periodo.em_andamento
      ? { fim: localParaIso(fim) }
      : { usuario_id: usuario, inicio: localParaIso(inicio), fim: localParaIso(fim) };
    const r = await chamar(`/api/plantao/${periodo.id}`, 'PATCH', corpo);
    setBusy(false);
    if (!r.ok) setErro(String(r.dados.error ?? 'Não foi possível salvar.'));
    else onSalvo();
  };

  return (
    <div className="flex flex-col gap-3">
      {!periodo.em_andamento && (
        <>
          <Field label="Técnico">
            <Select id={`ed-usuario-${periodo.id}`} value={usuario} onChange={(e) => setUsuario(e.target.value)} disabled={busy}>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}{t.sem_canal ? ' (sem Telegram nem app)' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Início">
            <Input id={`ed-inicio-${periodo.id}`} type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={busy} className="w-full" />
          </Field>
        </>
      )}
      <Field label="Fim">
        <Input id={`ed-fim-${periodo.id}`} type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} disabled={busy} className="w-full" />
      </Field>
      {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={salvar} disabled={busy || !fim}>{busy ? 'Salvando...' : 'Salvar'}</Button>
        <Button size="sm" variant="secondary" onClick={onCancelar} disabled={busy}>Cancelar</Button>
      </div>
    </div>
  );
}

function AdicionarPeriodo({ tecnicos, onMudou }: { tecnicos: Tecnico[]; onMudou: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const adicionar = async () => {
    setMsg(null);
    const alvo = tecnicos.find((t) => t.id === usuario);
    if (alvo?.sem_canal) {
      setMsg({ ok: false, texto: mensagemSemCanalDeAviso(alvo.nome) });
      return;
    }
    setBusy(true);
    const r = await chamar('/api/plantao', 'POST', { usuario_id: usuario, inicio: localParaIso(inicio), fim: localParaIso(fim) });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, texto: String(r.dados.error ?? 'Não foi possível adicionar.') });
      return;
    }
    setMsg({ ok: true, texto: 'Período adicionado.' });
    setInicio('');
    setFim('');
    onMudou();
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Adicionar período</p>
      <Field label="Técnico">
        <Select id="add-usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} disabled={busy}>
          <option value="">Escolha o técnico</option>
          {tecnicos.map((t) => (
            <option key={t.id} value={t.id}>{t.nome}{t.sem_canal ? ' (sem Telegram nem app)' : ''}</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Início">
          <Input id="add-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={busy} className="w-full" />
        </Field>
        <Field label="Fim">
          <Input id="add-fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} disabled={busy} className="w-full" />
        </Field>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" onClick={adicionar} disabled={busy || !usuario || !inicio || !fim}>
          {busy ? 'Adicionando...' : 'Adicionar período'}
        </Button>
        {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-amx-green' : 'text-amx-red-hover'}`}>{msg.texto}</p>}
      </div>
    </Card>
  );
}

function GerarRodizio({ tecnicos, onMudou }: { tecnicos: Tecnico[]; onMudou: () => void }) {
  const [ordem, setOrdem] = useState<string[]>([]);
  const [diaSemana, setDiaSemana] = useState('1');
  const [hora, setHora] = useState('8');
  const [duracao, setDuracao] = useState('7');
  const [semanas, setSemanas] = useState('4');
  const [previa, setPrevia] = useState<{ periodos: PeriodoPrevia[]; pulados: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const nome = (id: string) => tecnicos.find((t) => t.id === id)?.nome ?? '';
  const escolher = (t: Tecnico) => {
    setPrevia(null);
    if (ordem.includes(t.id)) {
      setOrdem(ordem.filter((i) => i !== t.id));
      return;
    }
    if (t.sem_canal) {
      setMsg({ ok: false, texto: mensagemSemCanalDeAviso(t.nome) });
      return;
    }
    setMsg(null);
    setOrdem([...ordem, t.id]);
  };

  const corpo = (confirmar: boolean) => ({
    usuarios_ids: ordem,
    dia_semana: Number(diaSemana),
    hora: Number(hora),
    duracao_dias: Number(duracao),
    semanas: Number(semanas),
    confirmar,
  });

  const verPrevia = async () => {
    setBusy(true);
    setMsg(null);
    const r = await chamar('/api/plantao/rodizio', 'POST', corpo(false));
    setBusy(false);
    if (!r.ok) {
      setPrevia(null);
      setMsg({ ok: false, texto: String(r.dados.error ?? 'Não foi possível calcular o rodízio.') });
      return;
    }
    setPrevia({ periodos: r.dados.periodos as PeriodoPrevia[], pulados: Number(r.dados.pulados ?? 0) });
  };

  const confirmar = async () => {
    setBusy(true);
    const r = await chamar('/api/plantao/rodizio', 'POST', corpo(true));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, texto: String(r.dados.error ?? 'Não foi possível criar o rodízio.') });
      return;
    }
    setPrevia(null);
    setMsg({ ok: true, texto: `${r.dados.criados} período${Number(r.dados.criados) !== 1 ? 's' : ''} criado${Number(r.dados.criados) !== 1 ? 's' : ''}.` });
    onMudou();
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Gerar rodízio</p>
      <p className="text-xs text-amx-muted">
        Toque nos técnicos na ordem em que vão se revezar. Ao fim da lista, volta ao primeiro.
      </p>
      <div className="flex flex-wrap gap-2">
        {tecnicos.map((t) => {
          const pos = ordem.indexOf(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={pos >= 0}
              onClick={() => escolher(t)}
              className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm transition-colors ${
                pos >= 0 ? 'border-amx-green bg-amx-green/15 text-white' : 'border-amx-line bg-amx-panel-2 text-amx-muted hover:border-amx-muted'
              }`}
            >
              <span className="font-semibold">{pos >= 0 ? `${pos + 1}. ` : ''}{t.nome}</span>
              {t.sem_canal && <Badge tone="warning">sem Telegram nem app</Badge>}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Troca na">
          <Select id="rod-dia" value={diaSemana} onChange={(e) => { setDiaSemana(e.target.value); setPrevia(null); }} disabled={busy}>
            {DIAS_SEMANA_NOME.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Hora">
          <Select id="rod-hora" value={hora} onChange={(e) => { setHora(e.target.value); setPrevia(null); }} disabled={busy}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </Select>
        </Field>
        <Field label="Duração (dias)">
          <Input id="rod-duracao" type="number" inputMode="numeric" min={1} max={62} value={duracao} onChange={(e) => { setDuracao(e.target.value); setPrevia(null); }} disabled={busy} />
        </Field>
        <Field label="Semanas">
          <Input id="rod-semanas" type="number" inputMode="numeric" min={1} max={52} value={semanas} onChange={(e) => { setSemanas(e.target.value); setPrevia(null); }} disabled={busy} />
        </Field>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="secondary" onClick={verPrevia} disabled={busy || ordem.length === 0}>
          {busy && !previa ? 'Calculando...' : 'Ver prévia'}
        </Button>
        {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-amx-green' : 'text-amx-red-hover'}`}>{msg.texto}</p>}
      </div>

      {previa && (
        <>
          <p className="text-sm text-white">
            <b>{previa.periodos.length}</b> período{previa.periodos.length !== 1 ? 's' : ''} a criar
            {previa.pulados > 0 ? ` · ${previa.pulados} já existia${previa.pulados !== 1 ? 'm' : ''} e foi pulado${previa.pulados !== 1 ? 's' : ''}` : ''}
          </p>
          <ul className="flex flex-col gap-1.5 max-h-60 overflow-auto">
            {previa.periodos.map((p) => (
              <li key={`${p.usuario_id}-${p.inicio}`} className="text-xs bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2">
                <span className="font-semibold text-white">{p.usuario_nome || nome(p.usuario_id)}</span>
                <span className="text-amx-muted"> · {formatarInstante(p.inicio)} até {formatarInstante(p.fim)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" onClick={confirmar} disabled={busy || previa.periodos.length === 0}>
              {busy ? 'Criando...' : `Criar ${previa.periodos.length} período${previa.periodos.length !== 1 ? 's' : ''}`}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPrevia(null)} disabled={busy}>Cancelar</Button>
          </div>
        </>
      )}
    </Card>
  );
}
