'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SignaturePad } from '@/components/os/SignaturePad';
import { FotoUpload } from '@/components/os/FotoUpload';
import { HistoricoPanel } from '@/components/os/HistoricoPanel';
import type { PessoaHistorico } from '@/lib/os-historico';
import { HistoricoCondominio } from '@/components/os/HistoricoCondominio';
import { useAmxUser } from '@/components/layout/AppShell';
import { isEscritorio, podeAbrirOS, podeAgendarOS, podeApagarOS, podeCancelarOS, podeEditarContatoEmCampo, podeEditarEquipamento, podeMarcarACaminho, podeOperarCampo, podeVerLocalizacao, podeVerModulo } from '@/lib/roles';
import { computeOsPrioridade, OS_STATUS_LABELS, OS_TIPO_LABELS } from '@/lib/os-priority';
import { pendenciasFinalizacao } from '@/lib/os-finalizacao';
import { formatarDataCurta } from '@/lib/os-agenda';
import { textoChegada, slaChegada, fmtHora } from '@/lib/os-sla';
import { linkMapaCoordenadas, textoPrecisao } from '@/lib/localizacao';
import { obterLocalizacao, corpoComLocalizacao } from '@/lib/localizacao-cliente';
import { tecnicoAtendeCondominio } from '@/lib/contato-acesso';
import { textoAviso, type ResultadoAviso } from '@/lib/aviso';
import { useTick } from '@/lib/useTick';
import { enfileirar, ouvirFila } from '@/lib/fila-envio';
import { useFilaEnvio } from '@/lib/useFilaEnvio';
import { fotoReduzidaDataUrl } from '@/lib/imagem-cliente';
import { equipamentosObrigatorios, nomeEquipamentoDoItem } from '@/lib/os-finalizacao';
import { LocalDoCondominio } from '@/components/os/LocalDoCondominio';
import { ContatosDoCondominio } from '@/components/os/ContatosDoCondominio';
import { EquipamentoForm, type EquipamentoFormData } from '@/components/cadastro/EquipamentoForm';
import type { AuditLog, ChecklistItem, Condominio, Contato, Equipamento, Foto, OS } from '@/lib/db';
import type { VinculosOS } from '@/lib/os-vinculos';
import { Icon } from '@/components/ui/Icon';
import { AcompanharTecnico } from '@/components/mapa/AcompanharTecnico';
import { CompartilharLocalizacao } from '@/components/mapa/CompartilharLocalizacao';

type Tab = 'checklist' | 'fotos' | 'assinaturas' | 'historico' | 'condominio';

export function OSModal({
  osId,
  condominioNome,
  onClose,
  onChanged,
  onDeleted,
}: {
  osId: string;
  condominioNome: string;
  onClose: () => void;
  onChanged: (os: OS) => void;
  /** Chamado depois que a OS foi apagada de vez (a lista tira a linha). */
  onDeleted?: (osId: string) => void;
}) {
  const user = useAmxUser();
  const [dialogo, setDialogo] = useState<'cancelar' | 'apagar' | null>(null);
  const [fotoParaRemover, setFotoParaRemover] = useState<Foto | null>(null);
  // Equipamento cadastrado por engano nesta OS (ainda sem foto) que o técnico
  // quer desfazer; o servidor reconfere o histórico antes de apagar.
  const [equipParaRemover, setEquipParaRemover] = useState<ChecklistItem | null>(null);
  useTick();
  // Cada ação responde ao seu predicado (src/lib/roles.ts): agenda (data,
  // técnico) e campo (checklist, fotos, assinaturas, finalizar) são coisas
  // diferentes — a secretária agenda mas não vai a campo.
  const podeAgenda = podeAgendarOS(user?.role);
  const ehTecnico = user?.role === 'tecnico';
  // Técnico só opera campo na OS que já é dele (corretiva sem técnico: antes tem
  // de "Assumir"); o servidor recusa o contrário.
  const podeCampo = podeOperarCampo(user?.role);
  const podeCancelar = podeCancelarOS(user?.role);
  const podeApagar = podeApagarOS(user?.role);
  const [avisoMsg, setAvisoMsg] = useState<{ texto: string; ok: boolean } | null>(null);

  const [os, setOs] = useState<OS | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('checklist');
  const [actionError, setActionError] = useState('');
  // OS anterior aberta a partir do "Histórico do condomínio" (só leitura).
  const [osAnteriorId, setOsAnteriorId] = useState<string | null>(null);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [historico, setHistorico] = useState<AuditLog[]>([]);
  const [pessoas, setPessoas] = useState<PessoaHistorico[]>([]);
  const [vinculos, setVinculos] = useState<VinculosOS | null>(null);
  // Endereço e contatos do local (bloco "Local": mapa e ligar).
  const [condominio, setCondominio] = useState<Partial<Condominio> | null>(null);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [tecnicos, setTecnicos] = useState<{ id: string; nome: string }[]>([]);

  const [uploadingMomento, setUploadingMomento] = useState<'antes' | 'depois' | null>(null);
  const [savingSignature, setSavingSignature] = useState<'tecnico' | 'zelador' | null>(null);
  // Quem assinou pelo condomínio: null = ainda não digitado (usa o zelador dos contatos).
  const [nomeZeladorEdit, setNomeZeladorEdit] = useState<string | null>(null);
  const [docZeladorEdit, setDocZeladorEdit] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [registrandoChegada, setRegistrandoChegada] = useState(false);
  const [avisandoACaminho, setAvisandoACaminho] = useState(false);
  const [corrigindoNome, setCorrigindoNome] = useState(false);

  // Fila de envio offline (src/lib/fila-envio.ts): foto e assinatura entram
  // primeiro no aparelho e sobem sozinhas quando houver rede. O que já subiu
  // chega aqui pelo evento e entra na tela sem recarregar a OS.
  const fila = useFilaEnvio(osId);
  const fotosPendentes = fila.flatMap((i) => (i.tipo === 'foto' ? [i] : []));
  const assinaturaPendente = (papel: 'tecnico' | 'zelador') =>
    fila.flatMap((i) => (i.tipo === 'assinatura' && i.papel === papel && !i.recusado ? [i] : []))[0];
  // Chegada registrada sem sinal: guarda a hora do toque e sobe sozinha.
  const chegadaPendente = fila.find((i) => i.tipo === 'chegada' && !i.recusado);
  const aCaminhoPendente = fila.find((i) => i.tipo === 'a_caminho' && !i.recusado);
  const aguardandoEnvio = fila.filter((i) => !i.recusado).length;
  const zeladorPendente = assinaturaPendente('zelador');
  const nomeZeladorPadrao = contatos.find((c) => c.papel === 'zelador' && c.ativo)?.nome ?? '';
  const nomeZelador = nomeZeladorEdit ?? nomeZeladorPadrao;
  // Quem usa o modal passa onChanged inline; o ref evita reinscrever a cada render.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  useEffect(
    () =>
      ouvirFila((e) => {
        if (e.tipo === 'foto_enviada' && e.foto.os_id === osId) {
          setFotos((prev) => (prev.some((f) => f.id === e.foto.id) ? prev : [...prev, e.foto]));
        }
        if ((e.tipo === 'assinatura_enviada' || e.tipo === 'chegada_enviada' || e.tipo === 'a_caminho_enviado') && e.os.id === osId) {
          setOs(e.os);
          onChangedRef.current(e.os);
        }
      }),
    [osId]
  );

  // O histórico muda com o que a pessoa faz na própria tela: ao abrir a aba,
  // busca de novo (senão mostraria só o que existia quando a OS abriu).
  useEffect(() => {
    if (tab !== 'historico') return;
    let cancelled = false;
    fetch(`/api/os/${osId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setHistorico(data.logs || []);
        setPessoas(data.pessoas || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab, osId]);

  // GET /api/os/:id já retorna os, checklist, fotos e histórico (logs) num
  // único payload (ver src/app/api/os/[id]/route.ts) — não existem rotas
  // GET separadas por aba, então uma chamada só basta.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/os/${osId}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setOs(data.os);
          setChecklist(data.checklist || []);
          setFotos(data.fotos || []);
          setHistorico(data.logs || []);
          setPessoas(data.pessoas || []);
          setVinculos(data.vinculos || null);
          setCondominio(data.condominio || null);
          setContatos(data.contatos || []);
        } else {
          const data = await res.json().catch(() => ({}));
          // Aviso de corretiva vai pra vários técnicos; quem chega depois de
          // outro assumir perde o acesso — o motivo mais provável é esse.
          setLoadError(
            res.status === 403 && user?.role === 'tecnico'
              ? 'Esta OS já foi assumida por outro técnico.'
              : data.error || 'Não foi possível carregar esta OS.'
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Erro de conexão ao carregar a OS.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [osId, user?.role]);

  // Diretório de técnicos pro bloco de agendamento. Mesmo cuidado de
  // src/app/page.tsx: técnico recebe {id, nome} sem `papel`.
  useEffect(() => {
    if (!podeAgenda) return;
    let cancelled = false;
    fetch('/api/users', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const users: { id: string; nome: string; papel?: string }[] = data.users || [];
        setTecnicos(users.filter((u) => u.papel === undefined || u.papel === 'tecnico'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [podeAgenda]);

  const isClosed = os?.status === 'finalizada' || os?.status === 'cancelada';
  // Mesma função que o backend usa em Database.finalizarOS — o botão trava
  // exatamente pelo que o servidor recusaria.
  // Envio ainda no aparelho também trava: o PDF sairia sem aquela foto.
  // O que está na fila conta como feito na lista (o técnico não precisa
  // refazer); a linha "aguardando rede" é que segura o botão.
  const pendencias = os
    ? [
        ...pendenciasFinalizacao({
          os: {
            ...os,
            assinatura_tecnico_url: os.assinatura_tecnico_url || assinaturaPendente('tecnico')?.data,
            assinatura_zelador_url: os.assinatura_zelador_url || assinaturaPendente('zelador')?.data,
            assinatura_zelador_nome:
              os.assinatura_zelador_nome || (zeladorPendente?.tipo === 'assinatura' ? zeladorPendente.nome : undefined),
          },
          checklist,
          fotos: [...fotos, ...fotosPendentes.filter((p) => !p.recusado)],
        }),
        ...(aguardandoEnvio > 0 ? [`${aguardandoEnvio} envio(s) aguardando rede — finalize depois que subirem`] : []),
      ]
    : [];
  const campoLiberado = podeCampo && (!ehTecnico || os?.tecnico_id === user?.id);
  const podeFinalizar = campoLiberado && !isClosed && pendencias.length === 0;

  // Cadastro do parque de máquinas na 1ª vistoria: o técnico cadastra o
  // equipamento aqui mesmo e o item "Inspecionar …" nasce no checklist.
  const podeCadastrarEquip = podeEditarEquipamento(user?.role) && campoLiberado && !isClosed;
  const condominioId = os?.condominio_id;
  const [temEquipamentos, setTemEquipamentos] = useState<boolean | null>(null);
  const [cadastrandoEquip, setCadastrandoEquip] = useState(false);
  const [salvandoEquip, setSalvandoEquip] = useState(false);
  const [erroEquip, setErroEquip] = useState('');
  const [avisoEquip, setAvisoEquip] = useState('');
  // O formulário rola no celular: erro/confirmação ficam no topo e o modal
  // rola até eles, senão o técnico toca em Salvar e não vê nada mudar.
  const statusEquipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erroEquip || avisoEquip) statusEquipRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [erroEquip, avisoEquip]);
  useEffect(() => {
    if (!podeCadastrarEquip || !condominioId || tab !== 'checklist') return;
    let cancelled = false;
    fetch(`/api/condominios/${condominioId}/equipamentos`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.equipamentos) setTemEquipamentos((data.equipamentos as Equipamento[]).length > 0);
      })
      .catch(() => {
        // Sem a resposta temEquipamentos fica null: a aba mostra o botão de
        // cadastro mesmo assim (ver ChecklistTab).
      });
    return () => {
      cancelled = true;
    };
  }, [podeCadastrarEquip, condominioId, tab]);

  // Devolve true se salvou (o form usa pra limpar no "Salvar e cadastrar outro").
  const salvarEquipamento = async (data: EquipamentoFormData): Promise<boolean> => {
    setSalvandoEquip(true);
    setErroEquip('');
    setAvisoEquip('');
    try {
      const res = await fetch(`/api/condominios/${condominioId}/equipamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, os_id: osId }),
      });
      const resp: { checklistItem?: ChecklistItem; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErroEquip(resp.error || 'Não foi possível salvar o equipamento.');
        return false;
      }
      if (resp.checklistItem) setChecklist((prev) => [...prev, resp.checklistItem!]);
      setTemEquipamentos(true);
      setAvisoEquip(`${data.tipo || 'Equipamento'}${data.identificacao ? ` — ${data.identificacao}` : ''} salvo. Cadastre o próximo.`);
      return true;
    } catch {
      setErroEquip('Sem conexão. Tente de novo.');
      return false;
    } finally {
      setSalvandoEquip(false);
    }
  };
  const fecharCadastroEquip = () => {
    setCadastrandoEquip(false);
    setErroEquip('');
    setAvisoEquip('');
  };

  // Agendamento (data da visita / técnico) — PATCH simples de um campo.
  const salvarAgendamento = async (campo: 'data_programada' | 'tecnico_id', valor: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
        setAvisoMsg(data.aviso ? textoAviso(data.aviso) : null);
      } else {
        setActionError(data.error || 'Falha ao salvar o agendamento.');
      }
    } catch {
      setActionError('Erro de conexão ao salvar o agendamento.');
    }
  };

  // Alterna o item do checklist. Desmarcar (item marcado por engano) é permitido
  // enquanto a OS está aberta para o campo; não pede confirmação (é reversível).
  const alternarChecklistItem = async (item: ChecklistItem) => {
    const marcar = !item.concluido;
    setActionError('');
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: marcar } : i)));
    const voltar = () => setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: item.concluido } : i)));
    try {
      const res = await fetch(`/api/os/${osId}/checklist/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido: marcar }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.item) {
        setChecklist((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      } else {
        voltar();
        setActionError(data.error || 'Falha ao atualizar o item do checklist.');
      }
    } catch {
      voltar();
      setActionError('Erro de conexão ao atualizar o item.');
    }
  };

  const addChecklistItem = async (descricao: string, obrigatorio: boolean) => {
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao, obrigatorio }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.item) {
        setChecklist((prev) => [...prev, data.item]);
      } else {
        setActionError(data.error || 'Falha ao adicionar item.');
      }
    } catch {
      setActionError('Erro de conexão ao adicionar item.');
    }
  };

  // "Estou a caminho": o condomínio vê no Painel. Sem sinal, entra na fila com
  // a hora do toque e sobe sozinho.
  const avisarACaminho = async () => {
    if (!os) return;
    setAvisandoACaminho(true);
    setActionError('');
    const horaDoToque = new Date().toISOString();
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a_caminho: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Não foi possível avisar que você está a caminho.');
      }
    } catch {
      try {
        await enfileirar({ tipo: 'a_caminho', os_id: osId, a_caminho_em: horaDoToque });
      } catch {
        setActionError('Não foi possível registrar. Tente de novo.');
      }
    } finally {
      setAvisandoACaminho(false);
    }
  };

  const registrarChegada = async () => {
    if (!os) return;
    setRegistrandoChegada(true);
    setActionError('');
    // Hora da chegada: o servidor grava a dele (relógio do celular errado não
    // burla o prazo). Só sem sinal vai a hora do aparelho, pela fila.
    const horaDoToque = new Date().toISOString();
    // Localização do celular (até ~8 s). Negada ou sem sinal: registra a
    // chegada do mesmo jeito, sem ela.
    const localizacao = await obterLocalizacao();
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'em_andamento', ...corpoComLocalizacao('chegada', localizacao) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Falha ao registrar a chegada.');
      }
    } catch {
      try {
        await enfileirar({ tipo: 'chegada', os_id: osId, entrada_em: horaDoToque, ...(localizacao ? { localizacao } : {}) });
      } catch {
        setActionError('Não foi possível registrar a chegada. Tente de novo.');
      }
    } finally {
      setRegistrandoChegada(false);
    }
  };

  // Finalizar não é uma rota própria — é PATCH /api/os/:id com
  // { finalizar: true } (a trava de qualidade roda dentro de
  // Database.finalizarOS e volta 422 se algo obrigatório ficou pendente).
  const finalizar = async () => {
    if (!podeFinalizar) return;
    setBusyAction(true);
    setActionError('');
    try {
      // Localização do celular na finalização (nunca trava: sem ela, finaliza igual).
      const localizacao = await obterLocalizacao();
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalizar: true, ...corpoComLocalizacao('finalizacao', localizacao) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Falha ao finalizar OS.');
      }
    } catch {
      setActionError('Erro de conexão.');
    } finally {
      setBusyAction(false);
    }
  };

  // A foto é reduzida no aparelho (1600 px — foto de celular sai com 4–8 MB,
  // pesada demais no 4G) e vai pra fila de envio, que guarda no aparelho
  // antes de mandar (POST /api/os/:id/fotos). Sem sinal, ela aparece como
  // "aguardando" e sobe sozinha.
  const uploadFoto = async (momento: 'antes' | 'depois', file: File, equipamento_id?: string) => {
    setUploadingMomento(momento);
    setActionError('');
    try {
      const data = await fotoReduzidaDataUrl(file);
      await enfileirar({ tipo: 'foto', os_id: osId, momento, data, ...(equipamento_id ? { equipamento_id } : {}) });
    } catch {
      setActionError('Não foi possível ler a foto. Tente tirar de novo.');
    } finally {
      setUploadingMomento(null);
    }
  };

  // Assinatura é PATCH /api/os/:id com assinatura_zelador/assinatura_tecnico
  // (data URL) — também passa pela fila de envio.
  const saveAssinatura = async (papel: 'tecnico' | 'zelador', dataUrl: string) => {
    setSavingSignature(papel);
    setActionError('');
    try {
      // Assinatura do zelador = o técnico ainda está no local: leva a localização da finalização.
      const localizacao = papel === 'zelador' ? await obterLocalizacao() : null;
      const extra =
        papel === 'zelador'
          ? {
              nome: nomeZelador.trim(),
              ...(docZeladorEdit.trim() ? { documento: docZeladorEdit.trim() } : {}),
              ...(localizacao ? { localizacao } : {}),
            }
          : {};
      await enfileirar({ tipo: 'assinatura', os_id: osId, papel, data: dataUrl, ...extra });
    } catch {
      setActionError('Não foi possível guardar a assinatura. Tente de novo.');
    } finally {
      setSavingSignature(null);
    }
  };

  // Assinatura do zelador que subiu sem nome (OS antiga ou envio sem o nome):
  // completa só o nome (e o documento) num PATCH separado.
  const salvarNomeZelador = async () => {
    const nome = nomeZelador.trim();
    if (nome.length < 2) {
      setActionError('Informe o nome de quem assinou.');
      return;
    }
    setSalvandoNome(true);
    setActionError('');
    try {
      // Assinatura ainda na fila: regrava o item com o nome novo (mesmo id), senão
      // o envio dela sobrescreveria a correção.
      if (zeladorPendente) {
        await enfileirar({
          tipo: 'assinatura', os_id: osId, papel: 'zelador', data: zeladorPendente.data, nome,
          ...(zeladorPendente.tipo === 'assinatura' && zeladorPendente.localizacao ? { localizacao: zeladorPendente.localizacao } : {}),
          ...(docZeladorEdit.trim() ? { documento: docZeladorEdit.trim() } : {}),
        });
        setCorrigindoNome(false);
        return;
      }
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assinatura_zelador_nome: nome,
          ...(docZeladorEdit.trim() ? { assinatura_zelador_documento: docZeladorEdit.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
        setCorrigindoNome(false);
      } else {
        setActionError(data.error || 'Não foi possível salvar o nome.');
      }
    } catch {
      setActionError('Sem conexão. Tente de novo.');
    } finally {
      setSalvandoNome(false);
    }
  };

  const cancelarOS = async (motivo: string) => {
    const res = await fetch(`/api/os/${osId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelar: true, motivo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.os) return data.error || 'Não foi possível cancelar a OS.';
    setOs(data.os);
    onChanged(data.os);
    setDialogo(null);
  };

  const apagarOS = async () => {
    const res = await fetch(`/api/os/${osId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || 'Não foi possível apagar a OS.';
    setDialogo(null);
    onDeleted?.(osId);
    onClose();
  };

  const removerFoto = async () => {
    if (!fotoParaRemover) return;
    const res = await fetch(`/api/os/${osId}/fotos/${fotoParaRemover.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || 'Não foi possível remover a foto.';
    setFotos((prev) => prev.filter((f) => f.id !== fotoParaRemover.id));
    setFotoParaRemover(null);
  };

  const podeRemoverFoto = campoLiberado && !isClosed;

  const removerEquipamentoCadastrado = async (): Promise<string | void> => {
    const item = equipParaRemover;
    if (!item?.equipamento_id) return;
    const res = await fetch(`/api/equipamentos/${item.equipamento_id}`, { method: 'DELETE' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return data.error || 'Não foi possível remover o equipamento.';
    // Recarrega o checklist (o item some, e itens iguais em outras OS não
    // importam aqui) e se o condomínio ainda tem equipamento.
    const [osRes, eqRes] = await Promise.all([
      fetch(`/api/os/${osId}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/condominios/${condominioId}/equipamentos`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (osRes?.checklist) setChecklist(osRes.checklist);
    else setChecklist((prev) => prev.filter((i) => i.id !== item.id));
    if (eqRes?.equipamentos) setTemEquipamentos((eqRes.equipamentos as Equipamento[]).length > 0);
    setEquipParaRemover(null);
  };

  return (
    <>
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !os ? (
        <>
          <ModalHeader title="Ordem de Serviço" onClose={onClose} />
          <div className="p-5">
            <EmptyState title="Não foi possível abrir esta OS" description={loadError || undefined} />
          </div>
        </>
      ) : (
        <>
          <ModalHeader
            title={condominioNome || 'Ordem de Serviço'}
            subtitle={`OS #${os.id.slice(0, 6).toUpperCase()} · ${OS_TIPO_LABELS[os.tipo].toUpperCase()} · aberta em ${new Date(os.criado_em).toLocaleString('pt-BR')}`}
            onClose={onClose}
          />
          <div className="p-5 flex flex-col gap-4">
            <OsSummary os={os} mostrarCanal={user?.role !== 'sindico'} />

            <LocalDoCondominio condominio={condominio} contatos={contatos} os={os} podeCadastrarEndereco={user?.role === 'admin'} />

            {podeEditarContatoEmCampo(user?.role) && (
              <ContatosDoCondominio
                condominioId={os.condominio_id}
                contatos={contatos}
                podeEditar={
                  isEscritorio(user?.role) ||
                  (os.tecnico_id === user?.id && tecnicoAtendeCondominio(user?.id ?? '', [os]))
                }
                onChange={setContatos}
              />
            )}

            {podeVerLocalizacao(user?.role) && <LocalizacaoDaVisita os={os} />}

            {(os.descricao_problema || os.solicitante_nome || os.solicitante_telefone) && (
              <div className="rounded-lg border border-amx-red/40 bg-amx-red/5 px-3.5 py-3 flex flex-col gap-1">
                <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-red-hover">CHAMADO</p>
                {os.descricao_problema && <p className="text-[13px] text-white">{os.descricao_problema}</p>}
                {(os.solicitante_nome || os.solicitante_telefone) && (
                  <p className="text-xs text-amx-muted">
                    {[os.solicitante_nome, os.solicitante_telefone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {os.observacao && <p className="text-[13px] text-amx-muted">{os.observacao}</p>}

            <SlaBox os={os} />

            {podeAgenda && !isClosed && !os.tecnico_id && os.tipo === 'corretiva' && user?.role === 'tecnico' && (
              <Button size="sm" onClick={() => salvarAgendamento('tecnico_id', user.id)} className="w-fit">
                Assumir esta OS
              </Button>
            )}

            {avisoMsg && isEscritorio(user?.role) && (
              <p
                className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                  avisoMsg.ok ? 'text-amx-green bg-amx-green/10' : 'text-amx-amber bg-amx-amber/10'
                }`}
              >
                {avisoMsg.texto}
              </p>
            )}

            {podeAgenda && !isClosed ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Só o escritório muda o dia; o técnico vê a data para leitura. */}
                {ehTecnico ? (
                  os.data_programada && (
                    <p className="text-xs text-amx-muted self-end">Visita agendada: {formatarDataCurta(os.data_programada)}</p>
                  )
                ) : (
                  <Field label="Data da visita">
                    <Input
                      id="os-data-programada"
                      type="date"
                      value={os.data_programada || ''}
                      onChange={(e) => salvarAgendamento('data_programada', e.target.value)}
                    />
                  </Field>
                )}
                {/* Técnico não passa a OS adiante: trocar o responsável tira a OS dele. */}
                {!ehTecnico && (
                  <Field label="Técnico responsável">
                    <Select id="os-tecnico" value={os.tecnico_id || ''} onChange={(e) => salvarAgendamento('tecnico_id', e.target.value)}>
                      <option value="">Não atribuído</option>
                      {tecnicos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nome}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            ) : (
              os.data_programada && (
                <p className="text-xs text-amx-muted">Visita agendada: {formatarDataCurta(os.data_programada)}</p>
              )
            )}

            {vinculos?.origem && (
              podeVerModulo(user?.role, 'os') ? (
                <a
                  href={`/?os=${vinculos.origem.id}`}
                  className="text-xs font-semibold text-amx-blue-light hover:text-white transition-colors w-fit"
                >
                  <span className="inline-flex items-center gap-1"><Icon name="voltar" size={14} />Aberta durante a preventiva #{vinculos.origem.id.slice(0, 6).toUpperCase()}</span>
                </a>
              ) : (
                <p className="text-xs text-amx-muted">
                  Aberta durante a preventiva #{vinculos.origem.id.slice(0, 6).toUpperCase()}
                </p>
              )
            )}
            {vinculos?.equipamento && (
              <p className="text-xs text-amx-muted">
                Equipamento:{' '}
                <span className="text-white">
                  {[vinculos.equipamento.tipo, vinculos.equipamento.identificacao, vinculos.equipamento.modelo]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
            )}
            {os.tipo === 'preventiva' && (
              <CorretivasDaPreventiva
                os={os}
                checklist={checklist}
                corretivas={vinculos?.corretivas ?? []}
                podeAbrir={podeAbrirOS(user?.role) && os.status !== 'cancelada' && (user?.role !== 'tecnico' || os.tecnico_id === user.id)}
                podeLinkar={podeVerModulo(user?.role, 'os')}
                tecnicoId={user?.role === 'tecnico' ? user.id : undefined}
                onAberta={(nova, aviso) => {
                  setVinculos((v) => ({
                    origem: v?.origem ?? null,
                    equipamento: v?.equipamento ?? null,
                    corretivas: [...(v?.corretivas ?? []), nova],
                  }));
                  setAvisoMsg(aviso ? textoAviso(aviso) : null);
                }}
              />
            )}

            {os.pdf_url && (
              <a
                href={os.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-muted hover:text-white transition-colors w-fit"
              >
                <Icon name="documento" size={14} />
                Baixar PDF da OS
              </a>
            )}

            {actionError && (
              <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{actionError}</p>
            )}

            {/* Rastreio da rota (24/11): o técnico da OS compartilha a posição entre
                "a caminho" e "cheguei"; o escritório acompanha no mapa. */}
            {!isClosed && os.a_caminho_em && !os.entrada_em && !chegadaPendente && user?.role === 'tecnico' && os.tecnico_id === user.id && (
              <CompartilharLocalizacao osId={osId} aCaminhoEm={os.a_caminho_em} ativo />
            )}
            {!isClosed && os.a_caminho_em && !os.entrada_em && isEscritorio(user?.role) && (
              <AcompanharTecnico osId={osId} paraEscritorio />
            )}

            {campoLiberado && !isClosed && (
              <div className="flex items-center gap-2 flex-wrap">
                {!os.entrada_em && !chegadaPendente && podeMarcarACaminho(user?.role) && (
                  os.a_caminho_em ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-blue-light">
                      <Icon name="rotas" size={14} />
                      A caminho desde {fmtHora(new Date(os.a_caminho_em).getTime())}
                    </span>
                  ) : aCaminhoPendente && aCaminhoPendente.tipo === 'a_caminho' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-amber">
                      <Icon name="nuvemEnvio" size={14} />
                      A caminho desde {fmtHora(new Date(aCaminhoPendente.a_caminho_em).getTime())} (aguardando envio)
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={avisarACaminho} disabled={avisandoACaminho || registrandoChegada || busyAction}>
                      <Icon name="rotas" size={14} />
                      {avisandoACaminho ? 'Avisando...' : 'Estou a caminho'}
                    </Button>
                  )
                )}
                {os.entrada_em ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-green">
                    <Icon name="check" size={14} />
                    {textoChegada(os.entrada_em)}
                  </span>
                ) : chegadaPendente && chegadaPendente.tipo === 'chegada' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-amber">
                    <Icon name="nuvemEnvio" size={14} />
                    {textoChegada(chegadaPendente.entrada_em)} (aguardando envio)
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={registrarChegada} disabled={registrandoChegada || busyAction}>
                    <Icon name="mapa" size={14} />
                    {registrandoChegada ? 'Pegando a localização...' : 'Cheguei no local'}
                  </Button>
                )}
                <div className="flex flex-col gap-1">
                  <Button size="sm" onClick={finalizar} disabled={!podeFinalizar || busyAction}>
                    {busyAction ? 'Finalizando...' : 'Finalizar OS'}
                  </Button>
                  {pendencias.length > 0 && (
                    <ul className="text-[11px] font-semibold text-amx-amber list-disc pl-4">
                      {pendencias.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {(podeCancelar || podeApagar) && (
              <div className="flex items-center gap-2 flex-wrap border-t border-amx-line pt-3">
                <span className="text-[11px] text-amx-muted mr-1">Gestão:</span>
                {podeCancelar && !isClosed && (
                  <Button size="sm" variant="secondary" onClick={() => setDialogo('cancelar')}>
                    Cancelar OS
                  </Button>
                )}
                {podeApagar && (
                  <Button size="sm" variant="danger" onClick={() => setDialogo('apagar')}>
                    Apagar OS
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 bg-amx-panel-2 border border-amx-line rounded-full p-1 w-fit max-w-full overflow-x-auto">
              {(
                [
                  ['checklist', `Checklist${checklist.length ? ` (${checklist.length})` : ''}`],
                  ['fotos', 'Fotos'],
                  ['assinaturas', 'Assinaturas'],
                  // Síndico não vê o histórico interno (o servidor nem manda os logs).
                  ...(user?.role === 'sindico' ? [] : [['historico', 'Histórico'] as [Tab, string]]),
                  // Técnico consulta as OS anteriores do local (só leitura).
                  ...(ehTecnico ? [['condominio', 'Histórico do condomínio'] as [Tab, string]] : []),
                ] as [Tab, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    tab === value ? 'bg-amx-red text-white' : 'text-amx-muted hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'checklist' && (
              <ChecklistTab
                items={checklist}
                readOnly={!campoLiberado || isClosed}
                onAlternar={alternarChecklistItem}
                osStatus={os.status}
                visaoSindico={user?.role === 'sindico'}
                onAdd={addChecklistItem}
                fotoObrigatoria={new Set(equipamentosObrigatorios(os, checklist).map((i) => i.equipamento_id))}
                fotosEquip={fotos.filter((f) => f.equipamento_id)}
                pendentesEquip={fotosPendentes.filter((p) => p.equipamento_id)}
                onFotoEquip={(equipamentoId, momento, file) => uploadFoto(momento, file, equipamentoId)}
                onRemoverFoto={podeRemoverFoto ? setFotoParaRemover : undefined}
                podeCadastrarEquip={podeCadastrarEquip}
                temEquipamentos={temEquipamentos}
                onCadastrarEquip={() => setCadastrandoEquip(true)}
                onRemoverEquip={setEquipParaRemover}
              />
            )}

            {tab === 'fotos' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Fotos gerais do serviço</p>
                  {(os.tipo !== 'corretiva' || equipamentosObrigatorios(os, checklist).length > 0) && (
                    <p className="text-xs text-amx-muted">{os.tipo === 'corretiva' ? 'Opcional: as fotos do equipamento ficam no Checklist.' : 'Opcional na preventiva.'}</p>
                  )}
                </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FotoUpload
                  momento="antes"
                  fotos={fotos.filter((f) => f.momento === 'antes' && !f.equipamento_id)}
                  pendentes={fotosPendentes.filter((p) => p.momento === 'antes' && !p.equipamento_id)}
                  onUpload={(file) => uploadFoto('antes', file)}
                  disabled={!campoLiberado || isClosed}
                  busy={uploadingMomento === 'antes'}
                  onRemover={podeRemoverFoto ? setFotoParaRemover : undefined}
                />
                <FotoUpload
                  momento="depois"
                  fotos={fotos.filter((f) => f.momento === 'depois' && !f.equipamento_id)}
                  pendentes={fotosPendentes.filter((p) => p.momento === 'depois' && !p.equipamento_id)}
                  onUpload={(file) => uploadFoto('depois', file)}
                  disabled={!campoLiberado || isClosed}
                  busy={uploadingMomento === 'depois'}
                  onRemover={podeRemoverFoto ? setFotoParaRemover : undefined}
                />
              </div>
              </div>
            )}

            {tab === 'assinaturas' && (
              <div className="flex flex-col gap-5">
                <SignaturePad
                  label="Assinatura do técnico"
                  value={assinaturaPendente('tecnico')?.data ?? os.assinatura_tecnico_url}
                  pendente={!!assinaturaPendente('tecnico')}
                  onSave={(dataUrl) => saveAssinatura('tecnico', dataUrl)}
                  disabled={!campoLiberado || isClosed}
                  busy={savingSignature === 'tecnico'}
                />
                {(() => {
                  const zeladorAssinado = !!(zeladorPendente?.data ?? os.assinatura_zelador_url);
                  const nomeGravado =
                    os.assinatura_zelador_nome || (zeladorPendente?.tipo === 'assinatura' ? zeladorPendente.nome : '');
                  const docGravado =
                    os.assinatura_zelador_documento || (zeladorPendente?.tipo === 'assinatura' ? zeladorPendente.documento : '');
                  const editavel = campoLiberado && !isClosed;
                  return (
                    <div className="flex flex-col gap-3">
                      {(!nomeGravado || corrigindoNome) && editavel && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label={zeladorAssinado ? 'Nome de quem assinou' : 'Nome de quem vai assinar'} required>
                            <Input
                              value={nomeZelador}
                              onChange={(e) => setNomeZeladorEdit(e.target.value)}
                              placeholder="Nome do zelador ou síndico"
                              maxLength={120}
                              autoComplete="off"
                            />
                          </Field>
                          <Field label="Documento (opcional)" hint="RG ou CPF">
                            <Input
                              value={docZeladorEdit}
                              onChange={(e) => setDocZeladorEdit(e.target.value)}
                              maxLength={40}
                              autoComplete="off"
                            />
                          </Field>
                        </div>
                      )}
                      <SignaturePad
                        label="Assinatura do zelador"
                        value={zeladorPendente?.data ?? os.assinatura_zelador_url}
                        pendente={!!zeladorPendente}
                        onSave={(dataUrl) => saveAssinatura('zelador', dataUrl)}
                        disabled={!editavel}
                        bloqueioConfirmar={
                          !zeladorAssinado && nomeZelador.trim().length < 2
                            ? 'Escreva o nome de quem vai assinar, acima, para liberar o botão Confirmar.'
                            : undefined
                        }
                        busy={savingSignature === 'zelador'}
                      />
                      {zeladorAssinado && nomeGravado && !corrigindoNome && (
                        <p className="text-xs text-amx-muted flex items-center gap-2 flex-wrap">
                          <span>
                            Assinado por: <b className="text-white">{nomeGravado}</b>
                            {docGravado ? ` (${docGravado})` : ''}
                          </span>
                          {editavel && (
                            <button
                              type="button"
                              onClick={() => {
                                setNomeZeladorEdit(nomeGravado);
                                setDocZeladorEdit(docGravado ?? '');
                                setCorrigindoNome(true);
                              }}
                              className="underline underline-offset-2 hover:text-white min-h-[44px] px-2 inline-flex items-center"
                            >
                              Corrigir nome
                            </button>
                          )}
                        </p>
                      )}
                      {zeladorAssinado && editavel && (!nomeGravado || corrigindoNome) && (
                        <Button size="sm" onClick={salvarNomeZelador} disabled={salvandoNome || nomeZelador.trim().length < 2} className="w-fit">
                          {salvandoNome ? 'Salvando...' : 'Salvar nome'}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {tab === 'historico' && <HistoricoPanel logs={historico} pessoas={pessoas} />}

            {tab === 'condominio' && ehTecnico && (
              <HistoricoCondominio condominioId={os.condominio_id} osAtualId={os.id} onAbrir={setOsAnteriorId} />
            )}
          </div>

          <ConfirmDialog
            open={dialogo === 'cancelar'}
            titulo="Cancelar esta OS?"
            confirmarLabel="Cancelar OS"
            motivoLabel="Motivo do cancelamento"
            onConfirm={cancelarOS}
            onClose={() => setDialogo(null)}
          >
            <p>A OS sai da lista de abertas e do Dashboard, mas continua no histórico com o motivo.</p>
            <p>Use para OS aberta por engano, em duplicidade ou que o condomínio desmarcou.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={dialogo === 'apagar'}
            titulo="Apagar esta OS de vez?"
            confirmarLabel="Apagar OS"
            perigo
            onConfirm={apagarOS}
            onClose={() => setDialogo(null)}
          >
            <p>
              Apaga a OS com checklist, fotos, assinaturas e PDF. <b className="text-white">Não tem como desfazer.</b>
            </p>
            <p>Para tirar da fila sem perder o histórico, use &quot;Cancelar OS&quot;.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={!!equipParaRemover}
            titulo="Remover equipamento?"
            confirmarLabel="Remover equipamento"
            perigo
            onConfirm={removerEquipamentoCadastrado}
            onClose={() => setEquipParaRemover(null)}
          >
            <p>
              Remover <b className="text-white">{equipParaRemover ? nomeEquipamentoDoItem(equipParaRemover.descricao) : ''}</b>? Use só se foi cadastrado por engano.
            </p>
          </ConfirmDialog>
          <ConfirmDialog
            open={!!fotoParaRemover}
            titulo="Remover esta foto?"
            confirmarLabel="Remover foto"
            perigo
            onConfirm={removerFoto}
            onClose={() => setFotoParaRemover(null)}
          >
            {fotoParaRemover && (
              <img src={fotoParaRemover.url} alt="Foto a remover" className="w-32 h-32 object-cover rounded-lg border border-amx-line" />
            )}
            <p>Depois é só tirar a foto certa de novo.</p>
          </ConfirmDialog>
        </>
      )}
    </Modal>
    <Modal open={cadastrandoEquip} onClose={fecharCadastroEquip} maxWidth="max-w-md">
      <ModalHeader title="Cadastrar equipamento" subtitle={condominioNome} onClose={fecharCadastroEquip} />
      <div className="p-5">
        <div ref={statusEquipRef}>
          {erroEquip && (
            <div className="mb-3 text-xs font-semibold text-amx-red-hover" role="alert">
              {erroEquip}
            </div>
          )}
          {avisoEquip && !erroEquip && (
            <div className="mb-3 text-xs font-semibold text-amx-green" role="status">
              {avisoEquip}
            </div>
          )}
        </div>
        <EquipamentoForm
          onSubmit={async (d) => {
            if (await salvarEquipamento(d)) fecharCadastroEquip();
          }}
          onSalvarEOutro={salvarEquipamento}
          onCancel={fecharCadastroEquip}
          busy={salvandoEquip}
        />
      </div>
    </Modal>
    {osAnteriorId && (
      <OSModal
        osId={osAnteriorId}
        condominioNome={condominioNome}
        onClose={() => setOsAnteriorId(null)}
        onChanged={() => {}}
      />
    )}
    </>
  );
}

// Pedido 10: durante a preventiva o técnico acha um defeito (ex.: bomba que
// precisa ir pra oficina) e abre a corretiva ali mesmo, já ligada à
// preventiva e ao equipamento. A corretiva segue o fluxo normal (prazo de 3h,
// aviso no Telegram); "Eu mesmo vou atender" já atribui a quem abriu.
function CorretivasDaPreventiva({
  os,
  checklist,
  corretivas,
  podeAbrir,
  podeLinkar,
  tecnicoId,
  onAberta,
}: {
  os: OS;
  checklist: ChecklistItem[];
  corretivas: VinculosOS['corretivas'];
  podeAbrir: boolean;
  /** Síndico não tem a lista de OS (/ leva ao Painel): sem link, só texto. */
  podeLinkar: boolean;
  tecnicoId?: string;
  onAberta: (nova: VinculosOS['corretivas'][number], aviso?: ResultadoAviso) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [equipamentoId, setEquipamentoId] = useState('');
  const [problema, setProblema] = useState('');
  const [euAtendo, setEuAtendo] = useState(!!tecnicoId);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const equipamentos = checklist.filter((i, idx, arr) => i.equipamento_id && arr.findIndex((j) => j.equipamento_id === i.equipamento_id) === idx);

  const abrir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problema.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condominio_id: os.condominio_id,
          tipo: 'corretiva',
          os_origem_id: os.id,
          equipamento_id: equipamentoId || undefined,
          descricao_problema: problema.trim(),
          observacao: `Aberta durante a preventiva #${os.id.slice(0, 6).toUpperCase()}`,
          tecnico_id: euAtendo && tecnicoId ? tecnicoId : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        onAberta(
          {
            id: data.os.id,
            status: data.os.status,
            descricao_problema: data.os.descricao_problema,
            equipamento_id: data.os.equipamento_id,
            criado_em: data.os.criado_em,
          },
          data.aviso
        );
        setAberto(false);
        setProblema('');
        setEquipamentoId('');
      } else {
        setErro(data.error || 'Não foi possível abrir a corretiva.');
      }
    } catch {
      setErro('Sem conexão: a corretiva precisa de rede para ser aberta. Tente de novo quando o sinal voltar.');
    } finally {
      setSalvando(false);
    }
  };

  if (!podeAbrir && corretivas.length === 0) return null;

  return (
    <div className="rounded-lg border border-amx-line bg-amx-panel-2 px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted">
          CORRETIVAS ABERTAS NESTA PREVENTIVA{corretivas.length ? ` (${corretivas.length})` : ''}
        </p>
        {podeAbrir && !aberto && (
          <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
            + Abrir corretiva
          </Button>
        )}
      </div>
      {corretivas.map((c) => (
        <a
          key={c.id}
          href={podeLinkar ? `/?os=${c.id}` : undefined}
          className={`text-xs text-white flex items-center gap-2 ${podeLinkar ? 'hover:text-amx-blue-light transition-colors' : ''}`}
        >
          <Badge tone={c.status === 'finalizada' ? 'success' : 'red'}>{OS_STATUS_LABELS[c.status]}</Badge>
          <span>
            #{c.id.slice(0, 6).toUpperCase()} — {c.descricao_problema || 'sem descrição'}
            {c.equipamento_id && (() => {
              const item = equipamentos.find((i) => i.equipamento_id === c.equipamento_id);
              return item ? ` · ${nomeEquipamentoDoItem(item.descricao)}` : '';
            })()}
          </span>
        </a>
      ))}
      {aberto && (
        <form onSubmit={abrir} className="flex flex-col gap-2.5 pt-1">
          {equipamentos.length > 0 && (
            <Field label="Equipamento com defeito">
              <Select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)}>
                <option value="">Nenhum específico</option>
                {equipamentos.map((i) => (
                  <option key={i.equipamento_id} value={i.equipamento_id}>
                    {nomeEquipamentoDoItem(i.descricao)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="O que foi encontrado" hint="Ex.: bomba 2 com selo vazando, precisa ir para a oficina">
            <Textarea value={problema} onChange={(e) => setProblema(e.target.value)} rows={2} required />
          </Field>
          {tecnicoId && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <input type="checkbox" checked={euAtendo} onChange={(e) => setEuAtendo(e.target.checked)} className="accent-amx-red" />
              Eu mesmo vou atender
            </label>
          )}
          {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={salvando || !problema.trim()}>
              {salvando ? 'Abrindo…' : 'Abrir corretiva'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// Onde o celular estava na chegada e na finalização (só gestor e secretária).
function LocalizacaoDaVisita({ os }: { os: OS }) {
  const linha = (rotulo: string, quando: string | undefined, lat?: number | null, lng?: number | null, precisao?: number | null) => {
    if (!quando) return null;
    const hora = fmtHora(new Date(quando).getTime());
    if (lat == null || lng == null) {
      return (
        <p className="text-[13px] text-amx-muted">
          {rotulo} às {hora} — sem localização
        </p>
      );
    }
    return (
      <p className="text-[13px] text-white">
        {rotulo} às {hora} —{' '}
        <a
          href={linkMapaCoordenadas(lat, lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-amx-blue-light hover:text-white underline underline-offset-2"
        >
          ver no mapa
        </a>
        {textoPrecisao(precisao) && <span className="text-amx-muted"> ({textoPrecisao(precisao)})</span>}
      </p>
    );
  };
  const chegada = linha('Chegada', os.entrada_em, os.chegada_lat, os.chegada_lng, os.chegada_precisao_m);
  const fim = linha('Finalização', os.status === 'finalizada' ? os.saida_em : undefined, os.finalizacao_lat, os.finalizacao_lng, os.finalizacao_precisao_m);
  if (!chegada && !fim) return null;
  return (
    <div className="rounded-lg border border-amx-line bg-amx-panel-2/40 px-3.5 py-3 flex flex-col gap-1.5">
      <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted">LOCALIZAÇÃO DA VISITA</p>
      {chegada}
      {fim}
    </div>
  );
}

function SlaBox({ os }: { os: OS }) {
  const sla = slaChegada(os);
  if (!sla) return null;
  const cor =
    sla.tone === 'red'
      ? 'border-amx-red bg-amx-red/10 text-amx-red-hover'
      : sla.tone === 'success'
        ? 'border-amx-green/50 bg-amx-green/10 text-amx-green'
        : 'border-amx-amber/50 bg-amx-amber/10 text-amx-amber';
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold ${cor}`}>
      <span className="inline-flex items-center gap-1.5">
        <Icon name="relogio" size={16} />
        Prazo de chegada (3h): {sla.label}
      </span>
    </div>
  );
}

function OsSummary({ os, mostrarCanal }: { os: OS; mostrarCanal: boolean }) {
  const prioridade = computeOsPrioridade(os);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={os.tipo === 'corretiva' ? 'red' : 'info'}>{OS_TIPO_LABELS[os.tipo]}</Badge>
      {/* Um selo só de situação: encerrada mostra o status, não "Encerrada" + "Finalizada". */}
      {os.status !== 'finalizada' && os.status !== 'cancelada' && <Badge tone={prioridade.tone}>{prioridade.label}</Badge>}
      <Badge tone={os.status === 'finalizada' ? 'success' : 'neutral'}>{OS_STATUS_LABELS[os.status]}</Badge>
      {mostrarCanal && os.canal_abertura === 'condominio' && <Badge tone="warning">Aberta pelo condomínio</Badge>}
      {os.origem === 'hermes_automatica' && <Badge tone="navy"><span className="inline-flex items-center gap-1"><Icon name="sensor" size={12} />Aberta automaticamente pelo Hermes</span></Badge>}
    </div>
  );
}

// Fotos de um equipamento do checklist (pedido 8): faixa "Antes" e faixa
// "Depois", cada uma com câmera e miniaturas. Quando o equipamento é
// obrigatório na OS (src/lib/os-finalizacao.ts), as duas são exigidas —
// sem elas a OS não finaliza. Em leitura, a faixa sem foto some.
function FotoEquipamento({
  obrigatoria,
  fotos,
  pendentes,
  readOnly,
  onFoto,
  onRemover,
}: {
  obrigatoria: boolean;
  fotos: Foto[];
  pendentes: { id: string; data: string; momento: 'antes' | 'depois'; recusado?: boolean; erro?: string }[];
  readOnly: boolean;
  onFoto: (momento: 'antes' | 'depois', file: File) => Promise<void>;
  onRemover?: (foto: Foto) => void;
}) {
  const faixas = (['antes', 'depois'] as const)
    .map((momento) => ({
      momento,
      fotos: fotos.filter((f) => f.momento === momento),
      pendentes: pendentes.filter((p) => p.momento === momento),
    }))
    .filter((f) => !readOnly || f.fotos.length + f.pendentes.length > 0);
  if (faixas.length === 0) return null;
  return (
    <div className="basis-full flex flex-col gap-1.5 pl-[34px]">
      {faixas.map((f) => (
        <FaixaFotoEquipamento
          key={f.momento}
          momento={f.momento}
          obrigatoria={obrigatoria}
          fotos={f.fotos}
          pendentes={f.pendentes}
          readOnly={readOnly}
          onFoto={(file) => onFoto(f.momento, file)}
          onRemover={onRemover}
        />
      ))}
    </div>
  );
}

function FaixaFotoEquipamento({
  momento,
  obrigatoria,
  fotos,
  pendentes,
  readOnly,
  onFoto,
  onRemover,
}: {
  momento: 'antes' | 'depois';
  obrigatoria: boolean;
  fotos: Foto[];
  pendentes: { id: string; data: string; recusado?: boolean; erro?: string }[];
  readOnly: boolean;
  onFoto: (file: File) => Promise<void>;
  onRemover?: (foto: Foto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const rotulo = momento === 'antes' ? 'Antes' : 'Depois';
  // Foto recusada pelo servidor não resolve a pendência: não conta como "tem".
  const recusadas = pendentes.filter((p) => p.recusado);
  const tem = fotos.length + pendentes.length - recusadas.length > 0;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="w-12 shrink-0 text-[11px] font-semibold text-amx-muted">{rotulo}</span>
      {fotos.map((f) => (
        <span key={f.id} className="relative">
          <a href={f.url} target="_blank" rel="noopener noreferrer">
            <img src={f.url} alt={`Foto ${rotulo.toLowerCase()} do equipamento`} className="w-11 h-11 rounded-md object-cover border border-amx-line" />
          </a>
          {onRemover && (
            <button
              type="button"
              onClick={() => onRemover(f)}
              aria-label={`Remover foto ${rotulo.toLowerCase()} do equipamento`}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-amx-bg border border-amx-line text-amx-muted hover:text-white hover:border-amx-red flex items-center justify-center"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </span>
      ))}
      {pendentes.map((p) => (
        <img
          key={p.id}
          src={p.data}
          alt="Foto aguardando envio"
          title={p.recusado ? p.erro : 'Aguardando envio'}
          className={`w-11 h-11 rounded-md object-cover border-2 border-dashed opacity-80 ${
            p.recusado ? 'border-amx-red' : 'border-amx-amber'
          }`}
        />
      ))}
      {!readOnly && (
        <button
          type="button"
          disabled={lendo}
          onClick={() => inputRef.current?.click()}
          aria-label={`${tem ? 'Adicionar outra foto' : 'Tirar foto'} ${rotulo.toLowerCase()} do equipamento`}
          className={`h-11 min-w-11 px-3 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
            !tem && obrigatoria
              ? 'border-amx-red text-amx-red-hover hover:bg-amx-red/10'
              : 'border-amx-line text-amx-muted hover:text-white'
          }`}
        >
          {lendo ? (
            <Spinner className="w-4 h-4" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
          {tem ? '+' : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setLendo(true);
              try {
                await onFoto(file);
              } finally {
                setLendo(false);
              }
            }}
          />
        </button>
      )}
      {obrigatoria && !readOnly && !tem && <span className="text-[10px] text-amx-muted">obrigatória</span>}
      {recusadas.map((p) => (
        <span key={p.id} className="basis-full pl-14 text-[11px] font-semibold text-amx-red-hover" role="alert">
          Foto não enviada: {p.erro || 'recusada pelo servidor.'}
        </span>
      ))}
    </div>
  );
}

function ChecklistTab({
  items,
  readOnly,
  onAlternar,
  onAdd,
  fotoObrigatoria,
  fotosEquip,
  pendentesEquip,
  onFotoEquip,
  onRemoverFoto,
  podeCadastrarEquip,
  temEquipamentos,
  onCadastrarEquip,
  onRemoverEquip,
  osStatus,
  visaoSindico,
}: {
  items: ChecklistItem[];
  readOnly: boolean;
  osStatus: OS['status'];
  /** Síndico lendo: numa OS finalizada, o que não se aplicou fica recolhido. */
  visaoSindico: boolean;
  onAlternar: (item: ChecklistItem) => void;
  onAdd: (descricao: string, obrigatorio: boolean) => void;
  fotoObrigatoria: Set<string>;
  fotosEquip: Foto[];
  pendentesEquip: { id: string; data: string; momento: 'antes' | 'depois'; equipamento_id?: string; recusado?: boolean; erro?: string }[];
  onFotoEquip: (equipamentoId: string, momento: 'antes' | 'depois', file: File) => Promise<void>;
  onRemoverFoto?: (foto: Foto) => void;
  podeCadastrarEquip: boolean;
  /** null = ainda não sabemos (carregando ou falhou). */
  temEquipamentos: boolean | null;
  onCadastrarEquip: () => void;
  onRemoverEquip: (item: ChecklistItem) => void;
}) {
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novoObrigatorio, setNovoObrigatorio] = useState(true);
  const [adding, setAdding] = useState(false);
  const [mostrarNaoAplicados, setMostrarNaoAplicados] = useState(false);

  // OS encerrada não tem pendência: nem finalizada (o que ficou sem marcar não
  // travou nada) nem cancelada (ninguém ia fazer). Sem borda nem "OBRIG." vermelho.
  const encerrada = osStatus === 'finalizada' || osStatus === 'cancelada';
  // Síndico numa OS finalizada: marcados primeiro; o que não se aplicou e não era
  // obrigatório fica atrás de um "Itens que não se aplicaram (n)".
  const resumirParaSindico = visaoSindico && osStatus === 'finalizada';
  const naoAplicaram = resumirParaSindico ? items.filter((i) => !i.concluido && !i.obrigatorio) : [];
  const principais = resumirParaSindico
    ? [...items.filter((i) => !naoAplicaram.includes(i))].sort((a, b) => Number(b.concluido) - Number(a.concluido))
    : items;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaDescricao.trim()) return;
    setAdding(true);
    await onAdd(novaDescricao.trim(), novoObrigatorio);
    setNovaDescricao('');
    setNovoObrigatorio(true);
    setAdding(false);
  };

  const renderItem = (item: ChecklistItem) => {
            // Item obrigatório e pendente ganha borda vermelha — é ele que
            // está travando o botão "Finalizar OS" (ver podeFinalizar acima).
            const bloqueando = !encerrada && item.obrigatorio && !item.concluido;
            return (
              <li
                key={item.id}
                className={`flex flex-wrap items-center gap-2.5 rounded-[9px] px-3.5 py-3 bg-amx-panel border ${
                  bloqueando ? 'border-amx-red' : 'border-amx-line'
                }`}
              >
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onAlternar(item)}
                  aria-label={item.concluido ? 'Desmarcar item' : 'Marcar como concluído'}
                  aria-pressed={item.concluido}
                  className={`w-[22px] h-[22px] rounded-[6px] shrink-0 flex items-center justify-center transition-colors disabled:cursor-not-allowed ${
                    item.concluido
                      ? 'bg-amx-green'
                      : `border-2 ${bloqueando ? 'border-amx-red' : 'border-amx-muted'} ${readOnly ? '' : 'hover:border-white'}`
                  }`}
                >
                  {item.concluido && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <span
                  className={`text-[13px] flex-1 ${
                    item.concluido ? 'text-amx-muted line-through' : item.obrigatorio ? 'text-white' : 'text-amx-muted'
                  }`}
                >
                  {item.descricao}
                </span>
                {!encerrada && item.obrigatorio && !item.concluido && (
                  <span className="font-heading text-[9px] font-semibold text-amx-red tracking-wider shrink-0">OBRIG.</span>
                )}
                {item.equipamento_id && (
                  <FotoEquipamento
                    obrigatoria={fotoObrigatoria.has(item.equipamento_id)}
                    fotos={fotosEquip.filter((f) => f.equipamento_id === item.equipamento_id)}
                    pendentes={pendentesEquip.filter((p) => p.equipamento_id === item.equipamento_id)}
                    readOnly={readOnly}
                    onFoto={(momento, file) => onFotoEquip(item.equipamento_id!, momento, file)}
                    onRemover={onRemoverFoto}
                  />
                )}
                {item.equipamento_id &&
                  !readOnly &&
                  !item.concluido &&
                  !fotosEquip.some((f) => f.equipamento_id === item.equipamento_id) &&
                  !pendentesEquip.some((p) => p.equipamento_id === item.equipamento_id) && (
                    <button
                      type="button"
                      onClick={() => onRemoverEquip(item)}
                      className="basis-full pl-[34px] text-left text-xs text-amx-muted hover:text-white underline underline-offset-2"
                    >
                      Remover equipamento
                    </button>
                  )}
              </li>
            );
  };

  return (
    <div className="flex flex-col gap-3">
      {podeCadastrarEquip && temEquipamentos === false && (
        <div className="flex flex-col gap-3 rounded-lg border border-amx-red bg-amx-panel px-4 py-4">
          <p className="text-sm font-semibold text-white">Este condomínio ainda não tem equipamentos cadastrados.</p>
          <p className="text-xs text-amx-muted">Cadastre antes de começar o serviço: cada equipamento vai pedir foto antes e depois.</p>
          <Button type="button" variant="primary" onClick={onCadastrarEquip} className="w-full sm:w-auto py-3 text-sm">
            Cadastrar equipamento
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="Checklist vazio" description="Nenhum item cadastrado para esta OS ainda." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {principais.map((item) => renderItem(item))}
          </ul>
          {naoAplicaram.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setMostrarNaoAplicados((v) => !v)}
                aria-expanded={mostrarNaoAplicados}
                className="self-start text-xs font-semibold text-amx-muted hover:text-white underline underline-offset-2"
              >
                Itens que não se aplicaram ({naoAplicaram.length})
              </button>
              {mostrarNaoAplicados && <ul className="flex flex-col gap-2">{naoAplicaram.map((item) => renderItem(item))}</ul>}
            </div>
          )}
        </>
      )}

      {podeCadastrarEquip && temEquipamentos !== false && (
        <button
          type="button"
          onClick={onCadastrarEquip}
          className="self-start text-xs font-semibold text-amx-muted hover:text-white underline underline-offset-2"
        >
          {temEquipamentos ? '+ Cadastrar outro equipamento' : '+ Cadastrar equipamento'}
        </button>
      )}

      {!readOnly && (
        <form onSubmit={handleAdd} className="flex items-end gap-2 flex-wrap bg-amx-panel-2 border border-amx-line rounded-lg p-3">
          <Field label="Novo item do checklist" hint="Ex.: Verificar nível da caixa d'água">
            <Input
              value={novaDescricao}
              onChange={(e) => setNovaDescricao(e.target.value)}
              placeholder="Descrição do item"
              className="w-64"
            />
          </Field>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-white pb-2.5">
            <input
              type="checkbox"
              checked={novoObrigatorio}
              onChange={(e) => setNovoObrigatorio(e.target.checked)}
              className="accent-amx-red"
            />
            Obrigatório
          </label>
          <Button type="submit" size="sm" disabled={adding || !novaDescricao.trim()}>
            + Adicionar
          </Button>
        </form>
      )}
    </div>
  );
}
