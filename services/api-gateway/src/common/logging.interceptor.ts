import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const req = context.switchToHttp().getRequest();
    const label = `${req.method} ${req.url}`;
    const correlationId = req.headers?.['x-correlation-id'];

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `${label} - ${Date.now() - start}ms - OK${correlationId ? ` - cid=${correlationId}` : ''}`,
        );
      }),
      catchError((err) => {
        this.logger.error(
          `${label} - ${Date.now() - start}ms - ERROR: ${err?.message ?? err}${correlationId ? ` - cid=${correlationId}` : ''}`,
        );
        throw err;
      }),
    );
  }
}
