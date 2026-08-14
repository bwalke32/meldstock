import 'server-only';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'This legacy shared message stream has been retired. Sign in to open a private thread.',
    },
    { status: 410 },
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
