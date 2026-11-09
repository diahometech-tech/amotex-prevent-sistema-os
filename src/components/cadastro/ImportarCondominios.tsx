'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ModalHeader } from '@/components/ui/Modal';
import {
  CABECALHO_MODELO,
  lerPlanilhaCondominios,
  parseCsv,
  type ResultadoLeitura,
} from '@/lib/importacao-condominios';

interface ResultadoImportacao {
  criados: string[];
  ignorados: { linha: number; nome?: string; motivo: string }[];
  avisos: { linha: number; nome: string; motivo: string }[];
}

// Excel em português salva "CSV (separado por vírgulas)" em Windows-1252,
// não UTF-8 — lido como UTF-8, "Condomínio" vira "Condom�nio". Tenta UTF-8
// estrito primeiro (cobre "CSV UTF-8" e Google Planilhas) e cai pro 1252.
async function lerArquivoTexto(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function baixarModelo() {
  const exemplo = 'Condomínio Exemplo;Rua das Flores, 100 - Centro - 01000-000;Administradora X;José da Silva;11999990000;Maria Souza;11988880000';
  const csv = `﻿${CABECALHO_MODELO.join(';')}\r\n${exemplo}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-condominios.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportarCondominios({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null);
  const [arquivo, setArquivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResultado(null);
    setArquivo(file.name);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setLeitura(null);
      setError('Envie o arquivo em CSV. No Excel: Arquivo › Salvar como › CSV.');
      return;
    }
    setLeitura(lerPlanilhaCondominios(parseCsv(await lerArquivoTexto(file))));
  };

  const importar = async () => {
    if (!leitura || leitura.linhas.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/condominios/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas: leitura.linhas }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setResultado(data);
        onImported();
      } else {
        setError(data.error || 'Falha ao importar.');
      }
    } catch {
      setError('Erro de conexão ao importar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalHeader title="Importar condomínios" subtitle="Cadastro em lote por planilha CSV" onClose={onClose} />
      <div className="p-5 flex flex-col gap-4">
        {resultado ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-white">
              {resultado.criados.length} condomínio{resultado.criados.length !== 1 ? 's' : ''} cadastrado
              {resultado.criados.length !== 1 ? 's' : ''}.
            </p>
            {resultado.ignorados.length > 0 && (
              <ListaMotivos titulo="Não importados" itens={resultado.ignorados} tom="text-amx-red-hover" />
            )}
            {resultado.avisos.length > 0 && (
              <ListaMotivos titulo="Avisos" itens={resultado.avisos} tom="text-amx-amber" />
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Fechar</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[13px] text-amx-muted flex flex-col gap-1.5">
              <p>
                Uma linha por condomínio. Colunas: <b className="text-white">nome</b> (obrigatória), endereco,
                administradora, zelador_nome, zelador_telefone, sindico_nome, sindico_telefone.
              </p>
              <p>Telefone com DDD vira contato de WhatsApp (zelador nível 1, síndico nível 2). Nome já cadastrado é ignorado.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={baixarModelo}>
                Baixar planilha modelo
              </Button>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-white cursor-pointer bg-amx-red hover:bg-amx-red-hover rounded-lg px-3 py-2">
                Escolher arquivo CSV
                <input id="importar-csv" type="file" accept=".csv,text/csv,.txt" onChange={handleFile} className="sr-only" />
              </label>
              {arquivo && <span className="text-xs text-amx-muted truncate max-w-[200px]">{arquivo}</span>}
            </div>

            {leitura?.erroArquivo && <p className="text-xs font-semibold text-amx-red-hover">{leitura.erroArquivo}</p>}

            {leitura && !leitura.erroArquivo && (
              <>
                <div className="overflow-x-auto border border-amx-line rounded-lg max-h-64">
                  <table className="w-full text-xs">
                    <thead className="bg-amx-panel-2 text-amx-muted sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">Linha</th>
                        <th className="text-left px-2 py-1.5">Condomínio</th>
                        <th className="text-left px-2 py-1.5">Endereço</th>
                        <th className="text-left px-2 py-1.5">Zelador</th>
                        <th className="text-left px-2 py-1.5">Síndico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leitura.linhas.map((l) => (
                        <tr key={l.linha} className="border-t border-amx-line text-white">
                          <td className="px-2 py-1.5 text-amx-muted tabular-nums">{l.linha}</td>
                          <td className="px-2 py-1.5 font-semibold">{l.nome}</td>
                          <td className="px-2 py-1.5 text-amx-muted">{l.endereco || '—'}</td>
                          <td className="px-2 py-1.5">{[l.zelador_nome, l.zelador_telefone].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-2 py-1.5">{[l.sindico_nome, l.sindico_telefone].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {leitura.erros.length > 0 && (
                  <ListaMotivos titulo="Linhas com problema (não serão importadas)" itens={leitura.erros} tom="text-amx-red-hover" />
                )}
              </>
            )}

            {error && <p className="text-xs font-semibold text-amx-red-hover">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="button" onClick={importar} disabled={busy || !leitura || leitura.linhas.length === 0}>
                {busy
                  ? 'Importando...'
                  : `Importar ${leitura?.linhas.length ?? 0} condomínio${leitura?.linhas.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ListaMotivos({
  titulo,
  itens,
  tom,
}: {
  titulo: string;
  itens: { linha: number; nome?: string; motivo: string }[];
  tom: string;
}) {
  return (
    <div>
      <p className={`text-xs font-semibold ${tom} mb-1`}>{titulo}</p>
      <ul className="text-xs text-amx-muted flex flex-col gap-0.5 max-h-32 overflow-auto">
        {itens.map((i, idx) => (
          <li key={`${i.linha}-${idx}`}>
            Linha {i.linha}
            {i.nome ? ` (${i.nome})` : ''}: {i.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}
