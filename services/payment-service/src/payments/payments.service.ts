import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRetry } from '../common/retry.util';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { OrderCreatedEvent } from './interfaces/payment-payloads.interface';

// Simulated external payment provider failure rate, used to exercise the
// retry path. A real integration would call a provider SDK here instead.
const SIMULATED_FAILURE_RATE = 0.2;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @Inject('ORDER_EVENTS_CLIENT')
    private readonly orderEventsClient: ClientProxy,
  ) {}

  async processOrderPayment(data: OrderCreatedEvent): Promise<void> {
    try {
      await withRetry(() => this.callExternalGateway(data.totalAmount), {
        retries: 2,
        baseDelayMs: 100,
        onRetry: (error, attempt) =>
          this.logger.warn(
            `Retry ${attempt} for order ${data.orderId}: ${(error as Error).message}`,
          ),
      });

      const payment = await this.paymentRepository.save(
        this.paymentRepository.create({
          orderId: data.orderId,
          userId: data.userId,
          amount: data.totalAmount,
          status: PaymentStatus.SUCCESS,
        }),
      );

      this.logger.log(
        `Payment ${payment.id} succeeded for order ${data.orderId}`,
      );
      this.orderEventsClient.emit('payment.completed', {
        orderId: data.orderId,
        paymentId: payment.id,
        status: 'SUCCESS',
      });
    } catch (error) {
      const payment = await this.paymentRepository.save(
        this.paymentRepository.create({
          orderId: data.orderId,
          userId: data.userId,
          amount: data.totalAmount,
          status: PaymentStatus.FAILED,
          failureReason: (error as Error).message,
        }),
      );

      this.logger.error(
        `Payment failed for order ${data.orderId}: ${(error as Error).message}`,
      );
      this.orderEventsClient.emit('payment.failed', {
        orderId: data.orderId,
        paymentId: payment.id,
        status: 'FAILED',
        reason: (error as Error).message,
      });
    }
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.paymentRepository.findOneBy({ orderId });
  }

  private async callExternalGateway(_amount: number): Promise<void> {
    if (Math.random() < SIMULATED_FAILURE_RATE) {
      throw new Error('Payment gateway timeout');
    }
  }
}
