'use client';

// Bloco "Local" da OS e botões de mapa/ligar reaproveitados na rota do dia.
// O técnico chega ao condomínio pelo celular: endereço à vista, um toque pra
// abrir o mapa e um toque pra ligar pra quem abre o portão. São links (<a>),
// não botões: o navegador do celular abre o app de mapas / discador sozinho.
import React from 'react';
import { enderecoCompleto, linkMapa, telefonesDoLocal, type TelefoneLocal } from '@/lib/endereco';
import type { Condominio, Contato, OS } from '@/lib/db';
import { Icon } from '@/components/ui/Icon';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors';
const GRANDE = 'w-full sm:w-auto text-sm px-4 py-3 min-h-[44px]';
const MAPA = 'border border-amx-line text-white hover:border-amx-muted hover:bg-amx-panel-2';
const LIGAR = 'bg-amx-red hover:bg-amx-red-hover text-white';

export function BotaoMapa({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`${BASE} ${GRANDE} ${MAPA}`}
    >
      <Icon name="mapa" size={18} />
      Abrir no mapa
    </a>
  );
}

export function BotaoLigar({ item }: { item: TelefoneLocal }) {
  return (
    <a
      href={item.href}
      onClick={(e) => e.stopPropagation()}
      className={`${BASE} ${GRANDE} ${LIGAR}`}
    >
      <Icon name="telefone" size={18} />
      {`Ligar — ${item.rotulo}${item.nome ? ` (${item.nome})` : ''}`}
    </a>
  );
}

// Bloco "Local" do OSModal. Vale pra todos os papéis que veem a OS.
export function LocalDoCondominio({
  condominio,
  contatos,
  os,
  podeCadastrarEndereco,
}: {
  condominio: Partial<Condominio> | null;
  contatos: Contato[];
  os: OS;
  podeCadastrarEndereco: boolean;
}) {
  const endereco = enderecoCompleto(condominio);
  const mapa = linkMapa(condominio);
  const telefones = telefonesDoLocal(condominio, contatos, os);

  return (
    <div className="rounded-lg border border-amx-line bg-amx-panel-2/40 px-3.5 py-3 flex flex-col gap-2.5">
      <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted">LOCAL</p>
      {endereco ? (
        <p className="text-[13px] text-white select-text">{endereco}</p>
      ) : (
        <p className="text-[13px] text-amx-muted">
          Endereço não cadastrado{podeCadastrarEndereco ? ' — cadastre em Condomínios.' : '.'}
        </p>
      )}
      {(mapa || telefones.length > 0) && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          {mapa && <BotaoMapa href={mapa} />}
          {telefones.map((t) => (
            <BotaoLigar key={t.href} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}
