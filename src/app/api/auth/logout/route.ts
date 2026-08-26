import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, getSessionFromRequest, getClientIp } from '@/lib/auth';
import { Database } from '@/lib/db';

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  if (session) {
    await Database.createSessionLog({
      user_name: session.name,
      role: session.role,
      action: 'logout',
      ip_address: getClientIp(request),
    });
  }
  return res;
}
