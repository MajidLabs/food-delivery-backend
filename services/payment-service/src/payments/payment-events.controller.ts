import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { handleWithRetry } from '../common/rmq-retry.util';
import { OrderCreatedEvent } from './interfaces/payment-payloads.interface';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentEventsController {
  private readonly logger = new Logger(PaymentEventsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @EventPattern('order.created')
  async handleOrderCreated(
    @Payload() data: OrderCreatedEvent,
    @Ctx() context: RmqContext,
  ) {
    await handleWithRetry(
      context,
      () => this.paymentsService.processOrderPayment(data),
      this.logger,
    );
  }
}
