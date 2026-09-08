import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEventsController } from './payment-events.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    ClientsModule.registerAsync([
      {
        name: 'ORDER_EVENTS_CLIENT',
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: 'order_events_queue',
            queueOptions: {
              durable: true,
              // Must match Order Service's own consumer-side declaration of
              // this queue exactly (see order-service main.ts) - see the
              // matching comment in order-service/src/orders/orders.module.ts.
              arguments: { 'x-dead-letter-exchange': 'dlx.order' },
            },
            persistent: true,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [PaymentsController, PaymentEventsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
