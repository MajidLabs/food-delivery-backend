import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
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
  }
}
