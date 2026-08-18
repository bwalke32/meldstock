// @polsia:framework-owned — historical ownership tag; provider-neutral health endpoint.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'healthy' });
}
