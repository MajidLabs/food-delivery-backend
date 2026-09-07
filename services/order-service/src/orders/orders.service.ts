import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Order, OrderItem, OrderStatus } from './entities/order.entity';

const CACHE_TTL_SECONDS = 60;
const cacheKey = (orderId: string) => `order:${orderId}`;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly redisService: RedisService,
    @Inject('PAYMENT_EVENTS_CLIENT')
    private readonly paymentEventsClient: ClientProxy,
  ) {}

  async create(dto: { items: OrderItem[] }, userId: string): Promise<Order> {
    const totalAmount = dto.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const order = await this.orderRepository.save(
      this.orderRepository.create({
        userId,
        items: dto.items,
        totalAmount,
        status: OrderStatus.PENDING,
      }),
    );

    this.logger.log(
      `Order ${order.id} created for user ${userId} — total ${totalAmount}`,
    );

    // Fire-and-forget: Payment Service owns the payment lifecycle from here.
    this.paymentEventsClient.emit('order.created', {
      orderId: order.id,
      userId: order.userId,
      totalAmount: order.totalAmount,
    });

    return order;
  }

  async findById(id: string, userId: string): Promise<Order> {
    const cached = await this.redisService.get<Order>(cacheKey(id));
    if (cached) {
      if (cached.userId !== userId) {
        throw new RpcException({ status: 403, message: 'Forbidden' });
      }
      return cached;
    }

    const order = await this.orderRepository.findOneBy({ id });
    if (!order) {
      throw new RpcException({ status: 404, message: 'Order not found' });
    }
    if (order.userId !== userId) {
      throw new RpcException({ status: 403, message: 'Forbidden' });
    }

    await this.redisService.set(cacheKey(id), order, CACHE_TTL_SECONDS);
    return order;
  }

  async findAllByUser(userId: string): Promise<Order[]> {
    return this.orderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatusFromPayment(
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status });
    await this.redisService.del(cacheKey(orderId));
    this.logger.log(`Order ${orderId} status updated to ${status}`);
  }
}
