import { z } from 'zod';
import { LotConditionEnum, PolymerEnum } from '@/lib/contracts/lots';

export const MaterialIntakeRequest = z
  .object({
    requestText: z.string().trim().min(8, 'Describe the material need').max(4000),
  })
  .strict();
export type MaterialIntakeRequest = z.infer<typeof MaterialIntakeRequest>;

export const MaterialIntakeEngine = z.enum(['ai', 'deterministic']);
export type MaterialIntakeEngine = z.infer<typeof MaterialIntakeEngine>;

export const MaterialIntakeField = z.enum([
  'material',
  'polymer',
  'condition',
  'color',
  'quantity',
  'destination',
  'country',
  'neededBy',
  'equivalency',
  'application',
  'technical',
]);
export type MaterialIntakeField = z.infer<typeof MaterialIntakeField>;

export const MaterialIntakeConfidence = z.enum(['high', 'medium']);

export const MaterialIntakeDraft = z
  .object({
    material: z.string().max(120),
    condition: LotConditionEnum,
    color: z.string().max(80),
    quantityLb: z.number().positive().nullable(),
    destination: z.string().max(160),
    country: z.string().max(80),
    neededBy: z.string().max(10),
    equivalentAllowed: z.boolean(),
    details: z.string().max(1000),
  })
  .strict();
export type MaterialIntakeDraft = z.infer<typeof MaterialIntakeDraft>;

export const MaterialIntakeAnalysis = z
  .object({
    engine: MaterialIntakeEngine,
    draft: MaterialIntakeDraft,
    recognized: z
      .array(
        z
          .object({
            field: MaterialIntakeField,
            label: z.string().min(1).max(40),
            value: z.string().min(1).max(160),
            confidence: MaterialIntakeConfidence,
          })
          .strict(),
      )
      .max(16),
    questions: z.array(z.string().min(1).max(180)).max(6),
    cautions: z.array(z.string().min(1).max(220)).max(6),
  })
  .strict();
export type MaterialIntakeAnalysis = z.infer<typeof MaterialIntakeAnalysis>;

export const MaterialIntakeBatchAnalysis = z
  .object({
    engine: MaterialIntakeEngine,
    items: z.array(MaterialIntakeAnalysis).min(1).max(8),
  })
  .strict();
export type MaterialIntakeBatchAnalysis = z.infer<typeof MaterialIntakeBatchAnalysis>;

// Provider-facing extraction shape. Every field is required by the JSON
// schema, but unknown facts are null. That distinction keeps the model from
// filling silence with plausible-sounding resin details.
export const MaterialIntakeExtraction = z
  .object({
    material: z.string().min(1).max(120).nullable(),
    manufacturer: z.string().min(1).max(80).nullable(),
    grade: z.string().min(1).max(80).nullable(),
    polymer: PolymerEnum.nullable(),
    condition: LotConditionEnum.nullable(),
    color: z.string().min(1).max(80).nullable(),
    quantityLb: z.number().positive().nullable(),
    destination: z.string().min(1).max(160).nullable(),
    country: z.string().min(1).max(80).nullable(),
    neededBy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    equivalentAllowed: z.boolean().nullable(),
    flameRating: z.string().min(1).max(40).nullable(),
    glassFiberPercent: z.number().min(0).max(100).nullable(),
    meltFlow: z.string().min(1).max(80).nullable(),
    application: z.string().min(1).max(180).nullable(),
    packaging: z.string().min(1).max(80).nullable(),
    annualUsageLb: z.number().positive().nullable(),
    certifications: z.array(z.string().min(1).max(80)).max(8),
    notes: z.array(z.string().min(1).max(180)).max(8),
    cautions: z.array(z.string().min(1).max(180)).max(6),
  })
  .strict();
export type MaterialIntakeExtraction = z.infer<typeof MaterialIntakeExtraction>;

export const MaterialIntakeBatchItemExtraction = MaterialIntakeExtraction.extend({
  sourceText: z.string().trim().min(1).max(4000),
}).strict();
export type MaterialIntakeBatchItemExtraction = z.infer<typeof MaterialIntakeBatchItemExtraction>;

export const MaterialIntakeBatchExtraction = z
  .object({
    items: z.array(MaterialIntakeBatchItemExtraction).min(1).max(8),
  })
  .strict();
export type MaterialIntakeBatchExtraction = z.infer<typeof MaterialIntakeBatchExtraction>;
