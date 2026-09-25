import { Static, Type } from '@sinclair/typebox';

export const HealthResponseSchema = Type.Object({
  ok: Type.Literal(true),
  service: Type.String(),
  version: Type.String(),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String()),
  }),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
