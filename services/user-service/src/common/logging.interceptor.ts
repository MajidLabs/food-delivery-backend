import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

/**
 * Logs every inbound HTTP request or RPC message with its duration and
 * outcome. Works for both transports because it relies only on
 * ExecutionContext.getClass()/getHandler(), which are transport-agnostic.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const type = context.getType();
    const controller = context.getClass().name;
    const handler = context.getHandler().name;

    let label = `${controller}.${handler}`;
    if (type === 'http') {
      const req = context.switchToHttp().getRequest();
      label = `${req.method} ${req.url}`;
    }

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`[${type}] ${label} - ${Date.now() - start}ms - OK`);
      }),
      catchError((err) => {
        this.logger.error(
          `[${type}] ${label} - ${Date.now() - start}ms - ERROR: ${err?.message ?? err}`,
        );
        throw err;
      }),
    );
  }
}
