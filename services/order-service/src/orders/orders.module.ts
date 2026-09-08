import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { Order } from './entities/order.entity';
import { OrderEventsController } from './order-events.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    RedisModule,
    ClientsModule.registerAsync([
      {
        name: 'PAYMENT_EVENTS_CLIENT',
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: 'payment_events_queue',
            queueOptions: {
              durable: true,
              // Must match Payment Service's own consumer-side declaration
              // of this queue exactly (see payment-service main.ts) - every
              // client/server that declares the same queue name must agree
              // on its arguments, or RabbitMQ rejects the second declarer
              // with a 406 PRECONDITION_FAILED and the connection is torn
              // down.
              arguments: { 'x-dead-letter-exchange': 'dlx.payment' },
            },
            persistent: true,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [OrdersController, OrderEventsController],
  providers: [OrdersService],
})
export class OrdersModule {}
