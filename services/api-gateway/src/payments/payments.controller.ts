import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { callService } from '../common/rpc-call.util';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject('PAYMENT_SERVICE') private readonly paymentClient: ClientProxy,
  ) {}

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get the payment record for an order' })
  findByOrder(@Param('orderId') orderId: string) {
    return callService(() =>
      this.paymentClient.send('payment.findByOrderId', { orderId }),
    );
  }
}
