import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { saveOsFotoDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/os/[id]/fotos  body: { momento: 'antes'|'depois', data: dataURL }
// Admin ou técnico. Cada foto é um arquivo próprio — não sobrescreve as
// anteriores (uma OS tem várias fotos de antes/depois).
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a esta OS.' }, { status: 403 });
  }
  try {
    const { momento, data } = await request.json();
    if (momento !== 'antes' && momento !== 'depois') {
      return NextResponse.json({ error: 'Informe o momento da foto: antes ou depois.' }, { status: 400 });
    }
    if (!data || typeof data !== 'string') {
      return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 });
    }
    const url = saveOsFotoDataUrl(data, id);
    if (!url) return NextResponse.json({ error: 'Formato de arquivo inválido (esperado data URL base64).' }, { status: 400 });

    const foto = await Database.createFoto({ os_id: id, momento, url });
    return NextResponse.json({ success: true, foto });
  } catch (e) {
    console.error('Erro no upload de foto:', e);
    return NextResponse.json({ error: 'Erro interno no upload.' }, { status: 500 });
  }
}
