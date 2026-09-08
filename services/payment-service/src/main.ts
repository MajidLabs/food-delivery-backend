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
  const rmqUrl = config.getOrThrow<string>('RABBITMQ_URL');

  // RPC command queue - default ack.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: 'payment_queue',
      queueOptions: { durable: true },
    },
  });

  // Event queue - manual ack with redelivery-count retry + dead-letter.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: 'payment_events_queue',
      queueOptions: {
        durable: true,
        arguments: { 'x-dead-letter-exchange': 'dlx.payment' },
      },
      noAck: false,
    },
  });

  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.startAllMicroservices();

  const port = config.get<number>('PORT') ?? 3003;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `[payment-service] HTTP health on :${port}, RMQ on "payment_queue" + "payment_events_queue"`,
  );
}
bootstrap();
