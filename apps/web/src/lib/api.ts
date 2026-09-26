export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = 'REQUEST_ERROR') {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao QuadrasFlow. Tente novamente.', 0, 'NETWORK_ERROR');
  }
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const body = data as { error?: string | { code?: string; message?: string } } | null;
    const error = body?.error;
    const message = typeof error === 'string' ? error : error?.message;
    const code = typeof error === 'object' ? error?.code : undefined;
    throw new ApiError(message || 'Não foi possível concluir a solicitação.', response.status, code);
  }
  return data as T;
}
