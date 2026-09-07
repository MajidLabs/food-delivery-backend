import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { AppLogger } from './common/app-logger.service';
import { LoggingInterceptor } from './common/logging.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new AppLogger());
  const config = app.get(ConfigService);

  // Single RMQ queue for User Service's request/response (RPC) commands.
  // Default ack mode is fine here: retries for these are handled by the
  // caller (API Gateway) via its own exponential-backoff retry wrapper.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.getOrThrow<string>('RABBITMQ_URL')],
      queue: 'user_queue',
      queueOptions: { durable: true },
    },
  });

  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.startAllMicroservices();

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `[user-service] HTTP health on :${port}, RMQ listening on "user_queue"`,
  );
}
bootstrap();
