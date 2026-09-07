import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FindPaymentByOrderPayload } from './interfaces/payment-payloads.interface';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @MessagePattern('payment.findByOrderId')
  findByOrderId(@Payload() data: FindPaymentByOrderPayload) {
    return this.paymentsService.findByOrderId(data.orderId);
  }
}
