// Normaliza texto para busca "aproximada": minusculas + remove acentos/diacriticos.
// NFD decompoe caracteres acentuados em base + marca combinante (ex.: "e" com
// acento agudo vira "e" + marca combinante separada); removendo o bloco
// Unicode de marcas combinantes (U+0300-U+036F) sobra so a base. Usado em
// toda busca por texto do sistema -- sem isso, buscar "joao" nao encontrava
// "Joao" com acento (caso real reportado: usuario busca sem acento, nada
// aparece).
export function normalizeSearch(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Nome de arquivo pra download do Certificado A1 (10/08/2026, pedido real:
// "quando for baixado o arquivo aparecer com o nome da empresa do
// certificado ou com o nome do arquivo que foi anexado"). Antes o atributo
// `download` das telas era vazio (`<a download>` sem valor) — o navegador
// usava o nome bruto salvo em disco (`certificado_a1_url.zip`, o nome do
// CAMPO, não do certificado). Prioridade: nome da empresa (mais útil pra
// quem recebe vários certificados) → nome original do arquivo anexado
// (capturado em `certificado_a1_nome` no upload, ver FileAttach/upload
// route) → undefined (deixa o navegador usar o nome da URL, comportamento
// antigo, só quando nenhum dos dois está disponível).
export function certificadoA1FileName(
  empresaNome?: string | null,
  nomeOriginal?: string | null,
  url?: string | null
): string | undefined {
  const ext = url?.split('.').pop()?.toLowerCase();
  const extSuffix = ext && /^(zip|rar)$/.test(ext) ? `.${ext}` : '';
  if (empresaNome?.trim()) {
    const safe = empresaNome.trim().replace(/[\\/:*?"<>|]/g, '-');
    return `${safe} - Certificado A1${extSuffix}`;
  }
  if (nomeOriginal?.trim()) return nomeOriginal.trim();
  return undefined;
}

// Nome de exibição do card de uma OS — assim que a empresa (razão social) já
// foi atribuída, o card mostra o nome dela em vez da pessoa física.
// Centralizado aqui pra ser reaproveitado por QUALQUER card do sistema — o
// pedido de negócio (12/08/2026) foi "para todos os acessos essa
// visualização deve ser aplicada", não só a tela de Certificação.
// **Não exige `bird_id_done`** (ajuste de acompanhamento, 12/08/2026,
// confirmado explicitamente pelo usuário: "só precisa ter nome da empresa,
// independente do e-CPF já ter sido concluído ou não") — a versão anterior
// dessa função exigia e-CPF concluído E empresa atribuída, e isso deixava
// cards com razão social já preenchida (ex.: via autofill de CNPJ na E2/E3)
// mas ainda sem o e-CPF feito mostrando o nome da pessoa física, reportado
// como bug real pelo usuário. Diferente da lista da tela Certificação
// (`primaryIsEmpresa`/`primaryName` em src/app/page.tsx), que continua
// exigindo `bird_id_done` de propósito — é uma regra própria e já
// documentada daquela tela especificamente, não foi alterada aqui.
export function empresaOuPessoa(
  clientName: string | null | undefined,
  empresaNome: string | null | undefined
): string {
  if (empresaNome?.trim()) return empresaNome;
  return clientName || '';
}
