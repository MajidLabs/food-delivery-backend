import { ConsoleLogger, Injectable } from '@nestjs/common';

/**
 * Structured JSON logger. Keeps the dependency footprint minimal (no external
 * logging library) while still producing machine-parseable log lines, which
 * is what most log aggregators (ELK, Loki, CloudWatch) expect.
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  private write(
    level: string,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context ?? 'App',
      message,
      ...extra,
    });
    process.stdout.write(line + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace ? { trace } : undefined);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }
}
