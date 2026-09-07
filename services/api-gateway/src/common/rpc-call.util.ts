import { HttpException } from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { withRetry } from './retry.util';

interface RpcErrorShape {
  status: number;
  message: string;
}

function isRpcErrorShape(error: unknown): error is RpcErrorShape {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  );
}

/**
 * Calls a downstream microservice via a fresh Observable per attempt
 * (retried with exponential backoff), then translates the internal
 * {status, message} RpcException shape into a proper HttpException so the
 * HTTP client gets the right status code instead of a generic 500.
 */
export async function callService<T>(
  factory: () => Observable<T>,
  retries = 2,
): Promise<T> {
  try {
    return await withRetry(() => firstValueFrom(factory()), {
      retries,
      baseDelayMs: 150,
    });
  } catch (error) {
    if (isRpcErrorShape(error)) {
      throw new HttpException(error.message, error.status);
    }
    throw new HttpException(
      (error as Error)?.message ?? 'Upstream service error',
      502,
    );
  }
}
