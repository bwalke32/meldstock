import 'server-only';

import { NextResponse } from 'next/server';
import { generateStructuredObject } from '@/lib/ai/client';
import { MATERIAL_INTAKE_JSON_SCHEMA, materialIntakeInstructions } from '@/lib/ai/material-intake';
import {
  buildDeterministicMaterialIntake,
  materialExtractionToAnalysis,
  mergeMaterialExtraction,
} from '@/lib/business/material-intake';
import {
  MaterialIntakeAnalysis,
  MaterialIntakeExtraction,
  MaterialIntakeRequest,
} from '@/lib/contracts/material-intake';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { checkLimit, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (response) {
    return response as Response;
  }

  const limit = checkLimit('aiChat', rateBucketFor(req, user.id, 'material-intake'));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
      },
    );
  }

  const parsed = MaterialIntakeRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors.requestText?.[0] ?? 'invalid_request' },
      { status: 400 },
    );
  }

  const { requestText } = parsed.data;
  const deterministic = buildDeterministicMaterialIntake(requestText);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const extracted = await generateStructuredObject({
      model: 'gpt-4o-mini',
      task: 'material-intake',
      temperature: 0.1,
      maxOutputTokens: 900,
      schemaName: 'meldstock_material_intake',
      jsonSchema: MATERIAL_INTAKE_JSON_SCHEMA as unknown as Record<string, unknown>,
      parse: (value) => MaterialIntakeExtraction.parse(value),
      messages: [
        { role: 'system', content: materialIntakeInstructions(today) },
        {
          role: 'user',
          content: `SOURCE_TEXT_START\n${requestText}\nSOURCE_TEXT_END`,
        },
      ],
      signal: AbortSignal.timeout(20_000),
    });
    const merged = mergeMaterialExtraction(requestText, extracted);
    const analysis = materialExtractionToAnalysis(requestText, merged, 'ai');
    return NextResponse.json(MaterialIntakeAnalysis.parse(analysis));
  } catch {
    // Disabled provider, timeout, malformed provider output, and upstream
    // failures all fall back to the same local parser. No provider detail or
    // credential-shaped error ever crosses the response boundary.
    return NextResponse.json(MaterialIntakeAnalysis.parse(deterministic));
  }
}
