// Exportação do dossiê completo para a pasta da empresa.
// Ao finalizar a OS, grava em DOSSIES_DIR/{EMPRESA - PROTOCOLO}/:
//   - OS de Abertura (.docx)
//   - todos os anexos (documentos, CNH, comprovantes, A1, CNPJ...)
//   - resumo.txt com os dados-chave
// Em produção, DOSSIES_DIR (ex.: /var/nexusflow/dossies) é sincronizado via
// Syncthing com o servidor interno da Contex.
import fs from 'fs';
import path from 'path';
import type { Dossier } from './db';
import { gerarOsAberturaDocx } from './os-abertura-doc';
import { FILE_FIELDS, resolveUploadFile, ensureDir } from './storage';

export const DOSSIES_DIR =
  process.env.DOSSIES_DIR || path.join(process.cwd(), 'dossies');

// Nome seguro para pasta/arquivo (Windows e Linux).
function sanitize(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Empresa';
}

export function dossierFolderName(d: Dossier): string {
  const empresa = d.empresa_nome || d.client_name || 'Empresa';
  const ref = d.protocolo || d.id;
  return sanitize(`${empresa} - ${ref}`);
}

export function buildResumoTxt(d: Dossier): string {
  return buildResumo(d);
}

function buildResumo(d: Dossier): string {
  const linha = (label: string, v?: string | boolean) =>
    v !== undefined && v !== '' ? `${label}: ${v === true ? 'Sim' : v === false ? 'Não' : v}\n` : '';
  return (
    `NEXUSFLOW — DOSSIÊ DE ABERTURA\n` +
    `==============================\n` +
    linha('Protocolo', d.protocolo) +
    linha('OS', d.id) +
    linha('Empresa', d.empresa_nome) +
    linha('Nome fantasia', d.nome_fantasia) +
    linha('CNPJ', d.cnpj_number) +
    linha('Cliente', d.client_name) +
    linha('CPF', d.cpf) +
    linha('Telefone', d.phone) +
    linha('E-mail', d.email) +
    linha('Endereço', d.address) +
    linha('Nível Gov', d.gov_level?.toUpperCase()) +
    linha('CNAE', d.cnae) +
    linha('Capital social', d.capital_social) +
    linha('Regime tributário', d.regime_tributario) +
    linha('Forma de pagamento', d.forma_pagamento) +
    linha('Tel. e-commerce', d.t2_new_phone) +
    linha('E-mail novo (T2)', d.t2_new_email) +
    linha('Captado por', d.captured_by) +
    linha('Criado em', d.created_at) +
    linha('Finalizado em', d.updated_at)
  );
}

// Copia OS .docx + anexos + resumo para a pasta da empresa.
// Retorna o caminho da pasta (ou lança erro — o chamador decide como tratar).
export async function exportDossierFolder(d: Dossier): Promise<string> {
  const dir = path.join(DOSSIES_DIR, dossierFolderName(d));
  ensureDir(dir);

  // 1) Ordem de Serviço de Abertura (.docx)
  const docx = await gerarOsAberturaDocx(d);
  const empresa = sanitize(d.empresa_nome || d.client_name || 'empresa').replace(/ /g, '_');
  fs.writeFileSync(path.join(dir, `OS_Abertura_${empresa}.docx`), docx);

  // 2) Anexos
  for (const { field, label } of FILE_FIELDS) {
    const url = (d as any)[field] as string | undefined;
    const src = resolveUploadFile(url);
    if (!src) continue;
    const ext = path.extname(src) || '.bin';
    try {
      fs.copyFileSync(src, path.join(dir, `${label}${ext}`));
    } catch (e) {
      console.error(`[dossie-export] Falha ao copiar ${label}:`, e);
    }
  }

  // 2b) Documentos avulsos (3 slots livres) — usa o nome digitado por quem
  // anexou como nome do arquivo, senão o dossiê exportado teria um anexo sem
  // identificação nenhuma pra quem abrir a pasta depois.
  for (let i = 1; i <= 3; i++) {
    const url = (d as any)[`doc_extra_${i}_url`] as string | undefined;
    const src = resolveUploadFile(url);
    if (!src) continue;
    const nome = ((d as any)[`doc_extra_${i}_nome`] as string | undefined)?.trim() || `Documento avulso ${i}`;
    const ext = path.extname(src) || '.bin';
    try {
      fs.copyFileSync(src, path.join(dir, `${sanitize(nome)}${ext}`));
    } catch (e) {
      console.error(`[dossie-export] Falha ao copiar ${nome}:`, e);
    }
  }

  // 3) Resumo
  fs.writeFileSync(path.join(dir, 'resumo.txt'), buildResumo(d), 'utf-8');

  return dir;
}
