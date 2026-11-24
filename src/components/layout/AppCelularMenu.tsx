'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { AppCelular } from '@/lib/useAppCelular';

export const PASSOS_IPHONE = [
  'Abra este endereço no Safari.',
  'Toque no botão Compartilhar (o quadrado com a seta para cima).',
  'Escolha "Adicionar à Tela de Início" e toque em Adicionar.',
  'Abra o app pelo ícone na tela inicial. Os avisos só funcionam por ele (iPhone com iOS 16.4 ou mais novo).',
];

// Itens do menu do usuário: instalar o app e avisos neste celular. Mesmo
// visual dos botões do rodapé do menu (Trocar senha / Sair).
export function AppCelularMenu({
  app,
  compacto,
  mostrarAvisos,
  botaoClasse,
}: {
  app: AppCelular;
  compacto: boolean;
  /** Só quem recebe aviso no celular vê o controle (o síndico ainda não recebe). */
  mostrarAvisos: boolean;
  botaoClasse: string;
}) {
  const [ajudaIphone, setAjudaIphone] = useState(false);
  const { instalacao, avisos } = app;

  const ligado = avisos === 'ligado';
  const podeAlternar = avisos === 'ligado' || avisos === 'desligado' || avisos === 'bloqueado';
  const rotuloAvisos = `Avisos neste celular: ${ligado ? 'Ligado' : 'Desligado'}`;
  const mostrarInstalar = instalacao === 'nativo' || instalacao === 'ios';

  return (
    <>
      {mostrarInstalar && (
        <button
          type="button"
          onClick={() => (instalacao === 'nativo' ? app.instalar() : setAjudaIphone((v) => !v))}
          aria-expanded={instalacao === 'ios' ? ajudaIphone : undefined}
          title={compacto ? 'Instalar o app' : undefined}
          aria-label={compacto ? 'Instalar o app' : undefined}
          className={botaoClasse}
        >
          <Icon name="instalar" size={20} className="shrink-0" />
          {!compacto && 'Instalar o app'}
        </button>
      )}
      {!compacto && instalacao === 'ios' && ajudaIphone && (
        <ol className="mx-1 mb-1 list-decimal pl-6 pr-2 text-xs leading-relaxed text-amx-muted flex flex-col gap-1">
          {PASSOS_IPHONE.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      )}

      {mostrarAvisos && podeAlternar && (
        <button
          type="button"
          disabled={app.ocupado}
          onClick={() => (ligado ? app.desligarAvisos() : app.ligarAvisos())}
          role="switch"
          aria-checked={ligado}
          title={compacto ? rotuloAvisos : undefined}
          aria-label={compacto ? rotuloAvisos : undefined}
          className={`${botaoClasse} disabled:opacity-60`}
        >
          <Icon name="sino" size={20} className="shrink-0" />
          {!compacto && (
            <span className="flex-1 min-w-0">
              Avisos neste celular:{' '}
              <span className={ligado ? 'font-semibold text-amx-green' : 'font-semibold'}>{ligado ? 'Ligado' : 'Desligado'}</span>
            </span>
          )}
        </button>
      )}
      {mostrarAvisos && !compacto && avisos === 'instalar' && (
        <p className="px-3 text-xs leading-relaxed text-amx-muted">
          No iPhone, os avisos só funcionam com o app instalado na tela inicial.
        </p>
      )}
      {mostrarAvisos && ligado && (
        <button
          type="button"
          disabled={app.ocupado}
          onClick={() => app.enviarTeste()}
          title={compacto ? 'Enviar aviso de teste' : undefined}
          aria-label={compacto ? 'Enviar aviso de teste' : undefined}
          className={`${botaoClasse} disabled:opacity-60`}
        >
          <Icon name="check" size={20} className="shrink-0" />
          {!compacto && 'Enviar aviso de teste'}
        </button>
      )}
      {mostrarAvisos && !compacto && avisos === 'bloqueado' && (
        <p className="px-3 text-xs leading-relaxed text-amx-muted">
          Os avisos estão bloqueados no navegador. Libere nas configurações do site e abra o menu de novo.
        </p>
      )}
      {!compacto && app.mensagem && (
        <p role="status" className="px-3 text-xs leading-relaxed text-amx-muted">
          {app.mensagem}
        </p>
      )}
    </>
  );
}
