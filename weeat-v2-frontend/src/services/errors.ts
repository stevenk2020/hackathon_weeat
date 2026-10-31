export class ServiceError extends Error { constructor(public code: string, message = code, public status?: number) { super(message); } }
export const errorKey = (e: unknown) => e instanceof ServiceError ? ({BLOCKED:'configurationBlocked', AUTH:'authBlocked', INVALID_RESPONSE:'serviceError', TIMEOUT:'serviceError'}[e.code] || e.code) : 'serviceError';
