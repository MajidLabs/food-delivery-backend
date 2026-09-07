import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { handleWithRetry } from '../common/rmq-retry.util';
import { OrderStatus } from './entities/order.entity';
import {
  PaymentCompletedEvent,
  PaymentFailedEvent,
} from './interfaces/order-payloads.interface';
import { OrdersService } from './orders.service';

/**
 * Event consumer. Listens on the dedicated `order_events_queue` in manual-ack
 * mode so failed handlers can be retried / dead-lettered without affecting
 * the RPC command queue above.
 */
@Controller()
export class OrderEventsController {
  private readonly logger = new Logger(OrderEventsController.name);

  constructor(private readonly ordersService: OrdersService) {}

  @EventPattern('payment.completed')
  async handlePaymentCompleted(
    @Payload() data: PaymentCompletedEvent,
    @Ctx() context: RmqContext,
  ) {
    await handleWithRetry(
      context,
      () =>
        this.ordersService.updateStatusFromPayment(
          data.orderId,
          OrderStatus.CONFIRMED,
        ),
      this.logger,
    );
  }

  @EventPattern('payment.failed')
  async handlePaymentFailed(
    @Payload() data: PaymentFailedEvent,
    @Ctx() context: RmqContext,
  ) {
    await handleWithRetry(
      context,
      () =>
        this.ordersService.updateStatusFromPayment(
          data.orderId,
          OrderStatus.FAILED,
        ),
      this.logger,
    );
  }
}
