import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const tasks = await Database.getTasksForUser(session.name);
  return NextResponse.json({ tasks });
}
