import { z } from "zod";

const recurrenceSchema = z.object({
    type: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
    interval: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(
        z.number().int().min(0).max(6),
    ).optional(),
});

const progressObjectiveSchema = z.object({
    title: z.string().trim().min(1).max(100),
    current: z.number().int().min(0).default(0),
    target: z.number().int().min(1).default(1),
}).refine(
    (objective) => objective.current <= objective.target,
    {
        message: "Current progress cannot exceed the target.",
        path: ["current"],
    },
);

export const customEventSchema = z.object({
    title: z.string().trim().min(1).max(120),

    description: z.string()
        .trim()
        .max(2000)
        .nullable()
        .optional(),

    account_scope: z.enum(["all", "account"]).default("all"),
    account_id: z.number().int().positive().nullable().optional(),

    start_at: z.iso.datetime({ offset: true }),
    end_at: z.iso.datetime({ offset: true }).nullable().optional(),

    recurrence: recurrenceSchema.default({
        type: "none",
        interval: 1,
    }),

    colour: z.string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#7c83ff"),

    reminder_minutes: z.number()
        .int()
        .min(0)
        .max(10080)
        .nullable()
        .optional(),

    progress: z.array(progressObjectiveSchema)
        .max(20)
        .default([]),
}).refine(
    (event) =>
        event.end_at == null ||
        Date.parse(event.end_at) > Date.parse(event.start_at),
    {
        message: "The end date and time must be after the start.",
        path: ["end_at"],
    },
).refine(
    (event) =>
        event.account_scope !== "account" ||
        event.account_id != null,
    {
        message: "Select an account for this event.",
        path: ["account_id"],
    },
);

export type CustomEventInput = z.input<typeof customEventSchema>;
export type CustomEventData = z.output<typeof customEventSchema>;


// =========================================
// CUSTOM EVENTS — API RESPONSE SCHEMAS
// =========================================

export const deleteCustomEventResponseSchema = z.object({
    success: z.literal(true),
    deleted_id: z.number().int().positive(),
});

export const customEventCompletionInputSchema = z.object({
    completed: z.boolean(),
    occurrence_start: z.iso.datetime({ offset: true }).optional(),
});

export const customEventCompletionResponseSchema = z.object({
    success: z.literal(true),
    event_id: z.number().int().positive(),
    occurrence_start: z.iso.datetime({ offset: true }),
    completed: z.boolean(),
});

export type CustomEventCompletionInput = z.infer<
    typeof customEventCompletionInputSchema
>;

export type CustomEventCompletionResponse = z.infer<
    typeof customEventCompletionResponseSchema
>;


// =========================================
// CUSTOM EVENTS — DATABASE RECORDS
// =========================================

export const customEventCompletionRecordSchema = z.object({
    occurrence_start: z.iso.datetime({ offset: true }),
    completed: z.boolean(),
    completed_at: z.iso.datetime({ offset: true }),
});

export const customEventRecordSchema = z.object({
    id: z.number().int().positive(),

    title: z.string(),
    description: z.string().nullable(),

    account_scope: z.enum(["all", "account"]),
    account_id: z.number().int().positive().nullable(),

    start_at: z.iso.datetime({ offset: true }),
    end_at: z.iso.datetime({ offset: true }).nullable(),
 
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),

    recurrence: recurrenceSchema,
    colour: z.string().regex(/^#[0-9a-f]{6}$/),
    reminder_minutes: z.number().int().nullable(),

    progress: z.array(progressObjectiveSchema),
    completions: z.array(customEventCompletionRecordSchema)
}).passthrough().refine(
    (event) =>
        (event.account_scope === "all" && event.account_id === null) ||
        (event.account_scope === "account" && event.account_id !== null),
    {
        message: "Account scope and account ID are inconsistent.",
        path: ["account_id"],
    },
);


// =========================================
// CUSTOM EVENTS — API RESPONSES
// =========================================

export const customEventsListResponseSchema = z.object({
    success: z.literal(true),
    events: z.array(customEventRecordSchema),
});

export const customEventResponseSchema = z.object({
    success: z.literal(true),
    event: customEventRecordSchema,
});

export type CustomEventRecord = z.infer<
    typeof customEventRecordSchema
>;

export type CustomEventCompletionRecord = z.infer<
    typeof customEventCompletionRecordSchema
>;

export type CustomEventsListResponse = z.infer<
    typeof customEventsListResponseSchema
>;

export type CustomEventResponse = z.infer<
    typeof customEventResponseSchema
>;