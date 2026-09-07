import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void | Observable<never> {
    const type = host.getType();

    if (type === 'http') {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      const payload =
        exception instanceof HttpException
          ? exception.getResponse()
          : { message: 'Internal server error' };

      this.logger.error(`HTTP ${status} - ${JSON.stringify(payload)}`);

      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        ...(typeof payload === 'string' ? { message: payload } : payload),
      });
      return;
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal error';
    this.logger.error(
      `RPC error - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const rpcException =
      exception instanceof RpcException ? exception : new RpcException(message);
    return throwError(() => rpcException.getError());
  }
}
