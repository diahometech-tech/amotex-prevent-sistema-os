'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useAppCelular } from '@/lib/useAppCelular';
import { PASSOS_IPHONE } from './AppCelularMenu';

const BOTAO =
  'inline-flex items-center gap-2 min-h-[44px] px-4 rounded-[10px] border border-amx-line text-sm font-semibold text-white hover:bg-amx-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amx-blue-light';

// Na Ajuda: como instalar o app e o link para mandar a síndicos e zeladores.
export function InstalarAppCard() {
  const app = useAppCelular();
  const [copiado, setCopiado] = useState(false);
  if (!app) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* sem permissão da área de transferência: o endereço continua visível na barra do navegador */
    }
  };

  return (
    <Card className="p-4 sm:p-5 mb-6 print:hidden">
      <h2 className="text-[15px] font-semibold text-white normal-case tracking-normal mb-2">Instalar o app no celular</h2>
      <p className="text-[13.5px] leading-relaxed text-amx-muted">
        O app fica na tela inicial do celular e abre com um toque. Quem recebe aviso de OS também recebe na barra de
        notificações.
      </p>

      {app.instalacao === 'instalado' ? (
        <p className="mt-3 text-[13.5px] font-semibold text-amx-green">O app já está instalado neste aparelho.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {app.instalacao === 'nativo' && (
            <div>
              <button type="button" onClick={() => app.instalar()} className={BOTAO}>
                <Icon name="instalar" size={20} />
                Instalar o app
              </button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 text-[13.5px] leading-relaxed text-white/90">
            <div>
              <p className="font-semibold text-white mb-1">Android (Chrome)</p>
              <ol className="list-decimal pl-5 flex flex-col gap-1">
                <li>Abra este endereço no Chrome.</li>
                <li>Toque nos três pontos, no canto de cima.</li>
                <li>Escolha &quot;Instalar app&quot; ou &quot;Adicionar à tela inicial&quot;.</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-white mb-1">iPhone (Safari)</p>
              <ol className="list-decimal pl-5 flex flex-col gap-1">
                {PASSOS_IPHONE.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={copiar} className={BOTAO}>
          Copiar link do app
        </button>
        <span role="status" className="text-[13px] text-amx-muted">
          {copiado ? 'Link copiado. É só mandar para o síndico ou o zelador.' : 'Para mandar a síndicos e zeladores.'}
        </span>
      </div>
    </Card>
  );
}
