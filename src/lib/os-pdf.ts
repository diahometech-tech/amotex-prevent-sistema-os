// Geração do PDF da OS (checklist, fotos antes/depois, assinaturas) — PRD v2,
// item Must: "Assinatura digital ... e geração automática de PDF". Gerado ao
// finalizar a OS (ver POST/PATCH em src/app/api/os/[id]/route.ts), salvo via
// saveOsPdfBuffer e servido depois por /uploads/os/[id]/os.pdf (mesmo escopo
// por condomínio das fotos/assinaturas).
//
// pdfkit em vez de docx+conversor: puro JS, sem binário nativo (LibreOffice/
// pandoc não existem neste ambiente nem fazem sentido na imagem Docker da
// VPS), e o PRD pede PDF, não DOCX.
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { resolveUploadFile } from './storage';
import type { Condominio, OS, ChecklistItem, Foto, User, Equipamento } from './db';
import { OS_TIPO_LABELS, OS_STATUS_LABELS } from './os-priority';
import { enderecoCompleto } from './endereco';
import { nomeEquipamentoDoItem } from './os-finalizacao';

// pdfkit só embute JPEG/PNG nativamente — uma foto em outro formato (ex.:
// webp, dependendo do navegador/câmera) entra como texto indicando o
// problema, em vez de derrubar a geração do PDF inteiro.
const EMBEDDABLE_EXT = new Set(['.jpg', '.jpeg', '.png']);

// Logo completa (selo + robô, 1000x554) do material de marca do cliente. Fica
// em public/ (asset estático, não upload de usuário).
const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'logo-amotex-completa.png');
const LOGO_LARGURA = 120;
const LOGO_ALTURA = LOGO_LARGURA * (554 / 1000);

export interface OsPdfData {
  os: OS;
  condominio: Condominio;
  checklist: ChecklistItem[];
  fotos: Foto[];
  tecnico: User | null;
  /** Corretiva aberta de dentro de uma preventiva: a preventiva de origem. */
  origem?: Pick<OS, 'id' | 'data_programada' | 'criado_em'> | null;
  /** Preventiva: corretivas abertas a partir dela. */
  corretivas?: Pick<OS, 'id' | 'descricao_problema' | 'status'>[];
  /** Equipamento com defeito (corretiva aberta da preventiva). */
  equipamento?: Pick<Equipamento, 'tipo' | 'identificacao' | 'modelo'> | null;
}

function curto(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

function fmtData(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Lê um arquivo do disco de forma ASSÍNCRONA para um Buffer. Usado em vez de
// deixar o pdfkit ler sozinho (doc.image(caminho) faz fs.readFileSync por
// baixo) — ver o comentário em generateOsPdf sobre por que isso importa.
// Qualquer falha (arquivo sumiu, sem permissão etc.) vira `null`, nunca
// exceção — quem decide o que fazer com um resultado nulo é o chamador.
async function readImageBuffer(filePath: string | null): Promise<Buffer | null> {
  if (!filePath) return null;
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

// Resolve uma URL de upload (foto/assinatura) para Buffer, já filtrando pela
// extensão que o pdfkit consegue embutir (ver EMBEDDABLE_EXT). Retorna null
// tanto para "não é JPEG/PNG" quanto para "não deu pra ler" — nos dois casos
// embedImageOrNote deve cair no aviso de fallback em vez de tentar desenhar.
async function loadEmbeddableImage(url: string | undefined | null): Promise<Buffer | null> {
  if (!url) return null;
  const ext = path.extname(url).toLowerCase();
  if (!EMBEDDABLE_EXT.has(ext)) return null;
  return readImageBuffer(resolveUploadFile(url));
}

export async function generateOsPdf(data: OsPdfData): Promise<Buffer> {
  const { os, condominio, checklist, fotos, tecnico, origem, corretivas = [], equipamento } = data;

  // Pré-carrega TODAS as imagens do documento (logo, fotos, assinaturas) em
  // paralelo e de forma assíncrona, antes de montar o PDF. pdfkit implementa
  // doc.image(caminho-em-string) com fs.readFileSync por baixo; chamado
  // dentro de um handler HTTP (ver src/app/api/os/[id]/route.ts), isso trava
  // o event loop do Node inteiro por cada foto — numa OS com várias fotos o
  // bloqueio escala linearmente com quantidade/tamanho e derruba todas as
  // requisições concorrentes do processo. Lendo tudo em Buffer aqui,
  // doc.image(buffer) mais abaixo não toca o disco.
  const [logoBuffer, assinaturaZeladorBuffer, assinaturaTecnicoBuffer, fotoBuffers] = await Promise.all([
    readImageBuffer(LOGO_PATH),
    loadEmbeddableImage(os.assinatura_zelador_url),
    loadEmbeddableImage(os.assinatura_tecnico_url),
    Promise.all(fotos.map((foto) => loadEmbeddableImage(foto.url))),
  ]);
  // Mapeia cada foto ao seu buffer já carregado (mesma ordem de `fotos`) para
  // não precisar re-resolver/re-ler nada na hora de desenhar antes/depois.
  const fotoBufferByFoto = new Map<Foto, Buffer | null>(fotos.map((foto, i) => [foto, fotoBuffers[i]]));

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Cabeçalho — logo à esquerda; título e número da OS à direita dela. Texto
  // como fallback (nunca derruba a geração do PDF por falta/erro de imagem).
  const topo = 45;
  const esquerda = doc.page.margins.left;
  const larguraUtil = doc.page.width - esquerda - doc.page.margins.right;
  let logoOk = false;
  try {
    if (!logoBuffer) throw new Error('logo indisponível');
    doc.image(logoBuffer, esquerda, topo, { width: LOGO_LARGURA });
    logoOk = true;
  } catch {
    logoOk = false;
  }
  if (logoOk) {
    const xTexto = esquerda + LOGO_LARGURA + 20;
    const wTexto = larguraUtil - LOGO_LARGURA - 20;
    doc.fontSize(18).fillColor('#0B1E3A').font('Helvetica-Bold').text('Ordem de Serviço', xTexto, topo + 12, { width: wTexto });
    doc.font('Helvetica').fontSize(9).fillColor('#999').text(`OS ${os.id}`, xTexto, doc.y + 4, { width: wTexto });
    doc.x = esquerda;
    doc.y = topo + LOGO_ALTURA + 14;
  } else {
    doc.fontSize(18).fillColor('#0B1E3A').text('Amotex Prevent');
    doc.fontSize(12).fillColor('#666').text('Ordem de Serviço');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#999').text(`OS ${os.id}`);
  }
  doc.moveDown();

  // Dados do condomínio e da OS
  doc.fillColor('#000').fontSize(11);
  doc.text(`Condomínio: ${condominio.nome}`);
  const enderecoPdf = enderecoCompleto(condominio);
  if (enderecoPdf) doc.text(`Endereço: ${enderecoPdf}`);
  doc.text(`Tipo: ${OS_TIPO_LABELS[os.tipo]}    Status: ${OS_STATUS_LABELS[os.status]}    Prioridade: ${os.prioridade}`);
  doc.text(`Técnico: ${tecnico?.nome ?? '—'}`);
  doc.text(`Aberta em: ${fmtData(os.criado_em)}    Entrada: ${fmtData(os.entrada_em)}    Saída: ${fmtData(os.saida_em)}`);
  if (os.descricao_problema || os.solicitante_nome || os.solicitante_telefone) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Chamado:', { continued: false });
    doc.font('Helvetica');
    if (os.descricao_problema) doc.text(os.descricao_problema);
    const solicitante = [os.solicitante_nome, os.solicitante_telefone].filter(Boolean).join(' · ');
    if (solicitante) doc.text(`Solicitante: ${solicitante}`);
  }
  if (origem) {
    doc.moveDown(0.3);
    doc.text(`Aberta durante a preventiva #${curto(origem.id)} (${fmtData(origem.criado_em)})`);
  }
  if (equipamento) {
    doc.text(`Equipamento: ${[equipamento.tipo, equipamento.identificacao, equipamento.modelo].filter(Boolean).join(' · ')}`);
  }
  if (os.observacao) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Observação:', { continued: false });
    doc.font('Helvetica').text(os.observacao);
  }
  doc.moveDown();

  // Checklist
  doc.font('Helvetica-Bold').fontSize(12).text('Checklist');
  doc.font('Helvetica').fontSize(10);
  if (checklist.length === 0) {
    doc.text('Nenhum item de checklist.');
  } else {
    for (const item of checklist) {
      const marca = item.concluido ? '[x]' : '[ ]';
      const obrig = item.obrigatorio ? ' (obrigatório)' : '';
      doc.text(`${marca} ${item.descricao}${obrig}`);
    }
  }
  doc.moveDown();

  if (corretivas.length > 0) {
    doc.font('Helvetica-Bold').fontSize(12).text('Corretivas abertas nesta visita');
    doc.font('Helvetica').fontSize(10);
    for (const c of corretivas) {
      doc.text(`#${curto(c.id)} — ${c.descricao_problema || 'sem descrição'} (${OS_STATUS_LABELS[c.status]})`);
    }
    doc.moveDown();
  }

  // Fotos por equipamento, com sub-rótulos Antes/Depois (preventiva e
  // corretiva). Qualquer foto com equipamento_id entra aqui; a ordem segue o
  // checklist e o nome vem do item ("Inspecionar X"). Em sequência (não lado
  // a lado): a foto de celular é vertical e, em 2 colunas, fica minúscula.
  const nomesEquip = new Map<string, string>();
  for (const item of checklist) {
    if (item.equipamento_id && !nomesEquip.has(item.equipamento_id)) {
      nomesEquip.set(item.equipamento_id, nomeEquipamentoDoItem(item.descricao));
    }
  }
  const idsComFoto = [...new Set(fotos.map((f) => f.equipamento_id).filter((x): x is string => !!x))];
  idsComFoto.sort((a, b) => {
    const ia = [...nomesEquip.keys()].indexOf(a);
    const ib = [...nomesEquip.keys()].indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  if (idsComFoto.length > 0) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Fotos dos equipamentos');
    doc.moveDown(0.2);
    for (const equipId of idsComFoto) {
      const doEquip = fotos.filter((f) => f.equipamento_id === equipId);
      // Nome e 1ª foto na mesma página (senão o nome fica órfão no rodapé).
      const primeira = fotoBufferByFoto.get(doEquip[0]) ?? null;
      if (primeira) {
        try {
          const img = (doc as PDFDocumentComOpenImage).openImage(primeira);
          const altura = 180 * (img.height / img.width) + 40;
          if (altura > doc.page.height - doc.page.margins.bottom - doc.y) doc.addPage();
        } catch {
          // imagem ilegível: embedImageOrNote mostra o aviso
        }
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(nomesEquip.get(equipId) ?? 'Equipamento');
      for (const [momento, rotulo] of [['antes', 'Antes'], ['depois', 'Depois']] as const) {
        const lista = doEquip.filter((f) => f.momento === momento);
        if (lista.length === 0) continue;
        doc.font('Helvetica').fontSize(9).fillColor('#666').text(rotulo);
        doc.fillColor('#000');
        for (const foto of lista) {
          embedImageOrNote(doc, foto.url, fotoBufferByFoto.get(foto) ?? null, 180);
          doc.moveDown(0.3);
        }
      }
      doc.moveDown(0.2);
    }
    doc.moveDown(0.3);
  }

  // Fotos antes/depois gerais (as de equipamento ficam na seção acima)
  const gerais = fotos.filter((f) => !f.equipamento_id);
  const antes = gerais.filter((f) => f.momento === 'antes');
  const depois = gerais.filter((f) => f.momento === 'depois');
  for (const [label, lista] of [['Fotos — antes', antes], ['Fotos — depois', depois]] as const) {
    if (lista.length === 0) continue;
    doc.font('Helvetica-Bold').fontSize(12).text(label);
    doc.moveDown(0.2);
    for (const foto of lista) {
      embedImageOrNote(doc, foto.url, fotoBufferByFoto.get(foto) ?? null, 200);
      doc.moveDown(0.3);
    }
    doc.moveDown(0.3);
  }

  // Assinaturas
  const temAssinatura = os.assinatura_zelador_url || os.assinatura_tecnico_url;
  if (temAssinatura) {
    doc.font('Helvetica-Bold').fontSize(12).text('Assinaturas');
    doc.moveDown(0.2);
    if (os.assinatura_zelador_url) {
      doc.font('Helvetica').fontSize(10).text('Zelador/Síndico:');
      embedImageOrNote(doc, os.assinatura_zelador_url, assinaturaZeladorBuffer, 150);
      if (os.assinatura_zelador_nome) {
        const docTxt = os.assinatura_zelador_documento ? ` (${os.assinatura_zelador_documento})` : '';
        doc.font('Helvetica').fontSize(10).text(`Assinado por: ${os.assinatura_zelador_nome}${docTxt}`);
      }
      doc.moveDown(0.3);
    }
    if (os.assinatura_tecnico_url) {
      doc.font('Helvetica').fontSize(10).text('Técnico:');
      embedImageOrNote(doc, os.assinatura_tecnico_url, assinaturaTecnicoBuffer, 150);
    }
  }

  doc.moveDown();
  doc.fontSize(8).fillColor('#999').text(`Documento gerado em ${fmtData(new Date().toISOString())}`, { align: 'right' });

  doc.end();
  return done;
}

// @types/pdfkit não declara `openImage` (só `image`, que já desenha), mas o
// método existe em runtime — é o que o próprio pdfkit usa internamente para
// decodificar antes de desenhar. Tipagem mínima só do que usamos, para não
// precisar de `any` solto no corpo da função.
type PDFDocumentComOpenImage = InstanceType<typeof PDFDocument> & {
  openImage(src: Buffer): { width: number; height: number };
};

// Antes de desenhar, verifica se a imagem cabe no espaço restante da página
// atual. pdfkit pagina texto corrido automaticamente, mas não imagens — sem
// essa checagem, fotos/assinaturas perto do fim da página são cortadas ou
// invadem a margem inferior em vez de começar numa página nova.
function ensureSpaceForImage(doc: InstanceType<typeof PDFDocument>, buffer: Buffer, width: number): void {
  const img = (doc as PDFDocumentComOpenImage).openImage(buffer);
  const renderedHeight = width * (img.height / img.width);
  const espacoRestante = doc.page.height - doc.page.margins.bottom - doc.y;
  if (renderedHeight > espacoRestante) {
    doc.addPage();
  }
}

function embedImageOrNote(doc: InstanceType<typeof PDFDocument>, url: string, buffer: Buffer | null, width: number): void {
  if (buffer) {
    try {
      ensureSpaceForImage(doc, buffer, width);
      doc.image(buffer, { width });
      return;
    } catch {
      // cai no aviso abaixo se o buffer existir mas não decodificar
    }
  }
  doc.fontSize(9).fillColor('#c00').text(`[não foi possível incluir a imagem: ${url}]`);
  doc.fillColor('#000');
}
