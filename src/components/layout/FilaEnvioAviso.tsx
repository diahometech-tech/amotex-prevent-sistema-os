'use client';

import { useEffect, useState } from 'react';
import { descartarItem, iniciarSincronizacao, ouvirFila, processarFila } from '@/lib/fila-envio';
import { useFilaEnvio } from '@/lib/useFilaEnvio';
import { Icon } from '@/components/ui/Icon';

function rotulo(n: number, tipo: 'foto' | 'assinatura' | 'chegada' | 'a_caminho'): string {
  if (tipo === 'a_caminho') return n === 1 ? '1 aviso de "a caminho"' : `${n} avisos de "a caminho"`;
  if (tipo === 'foto') return n === 1 ? '1 foto' : `${n} fotos`;
  if (tipo === 'chegada') return n === 1 ? '1 chegada' : `${n} chegadas`;
  return n === 1 ? '1 assinatura' : `${n} assinaturas`;
}

// Faixa no topo de todas as telas enquanto houver envio guardado no aparelho
// (fila offline — src/lib/fila-envio.ts). Também liga o reenvio automático.
export function FilaEnvioAviso() {
  const itens = useFilaEnvio();
  const [online, setOnline] = useState(true);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [tentando, setTentando] = useState(false);

  useEffect(() => {
    const parar = iniciarSincronizacao();
    const atualizarRede = () => setOnline(navigator.onLine !== false);
    atualizarRede();
    window.addEventListener('online', atualizarRede);
    window.addEventListener('offline', atualizarRede);
    const sair = ouvirFila((e) => {
      if (e.tipo === 'sessao_expirada') setSessaoExpirada(true);
      if (e.tipo === 'foto_enviada' || e.tipo === 'assinatura_enviada' || e.tipo === 'chegada_enviada' || e.tipo === 'a_caminho_enviado') setSessaoExpirada(false);
    });
    return () => {
      parar();
      sair();
      window.removeEventListener('online', atualizarRede);
      window.removeEventListener('offline', atualizarRede);
    };
  }, []);

  const aguardando = itens.filter((i) => !i.recusado);
  const recusados = itens.filter((i) => i.recusado);
  if (itens.length === 0 && online) return null;

  const fotos = aguardando.filter((i) => i.tipo === 'foto').length;
  const chegadas = aguardando.filter((i) => i.tipo === 'chegada').length;
  const aCaminho = aguardando.filter((i) => i.tipo === 'a_caminho').length;
  const assinaturas = aguardando.length - fotos - chegadas - aCaminho;
  const partes = [
    fotos && rotulo(fotos, 'foto'),
    assinaturas && rotulo(assinaturas, 'assinatura'),
    chegadas && rotulo(chegadas, 'chegada'),
    aCaminho && rotulo(aCaminho, 'a_caminho'),
  ].filter(Boolean);

  const tentarAgora = async () => {
    setTentando(true);
    try {
      await processarFila();
    } finally {
      setTentando(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5 border-b border-amx-amber/40 bg-amx-amber/10 text-amx-amber text-xs font-semibold">
      {aguardando.length > 0 ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-start gap-1.5">
            <Icon name="nuvemEnvio" size={16} className="shrink-0 mt-px" />
            <span>
            {partes.join(' e ')} aguardando envio.{' '}
            {sessaoExpirada
              ? 'Sua sessão expirou: entre de novo para enviar.'
              : online
                ? 'Enviando…'
                : 'Sem sinal — vai sozinho quando a rede voltar. Não precisa tirar de novo.'}
            </span>
          </span>
          {online && !sessaoExpirada && (
            <button
              type="button"
              onClick={tentarAgora}
              disabled={tentando}
              className="underline underline-offset-2 hover:text-white disabled:opacity-50 min-h-[44px] px-2 inline-flex items-center"
            >
              Tentar agora
            </button>
          )}
        </div>
      ) : (
        !online && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="semSinal" size={16} />
            Sem sinal. Fotos, assinaturas e chegadas ficam guardadas no aparelho até a rede voltar.
          </span>
        )
      )}
      {recusados.map((i) => (
        <div key={i.id} className="flex items-center gap-3 flex-wrap text-amx-red-hover">
          <span className="inline-flex items-start gap-1.5">
            <Icon name="alerta" size={16} className="shrink-0 mt-px" />
            <span>
            {i.tipo === 'foto' ? 'Foto' : i.tipo === 'chegada' ? 'Chegada' : i.tipo === 'a_caminho' ? 'Aviso de "a caminho"' : 'Assinatura'} da OS #{i.os_id.slice(0, 6).toUpperCase()} não foi aceita:{' '}
            {i.erro}
            </span>
          </span>
          <button type="button" onClick={() => descartarItem(i.id)} className="underline underline-offset-2 hover:text-white min-h-[44px] px-2 inline-flex items-center">
            Descartar
          </button>
        </div>
      ))}
    </div>
  );
}
