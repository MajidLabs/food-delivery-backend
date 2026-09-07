import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateOrderPayload,
  FindOrderPayload,
  FindOrdersByUserPayload,
} from './interfaces/order-payloads.interface';
import { OrdersService } from './orders.service';

/**
 * RPC (request/response) commands. This controller listens on `order_queue`
 * in default-ack mode — retries for these belong to the caller (API
 * Gateway), not to message redelivery.
 */
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @MessagePattern('order.create')
  create(@Payload() data: CreateOrderPayload) {
    return this.ordersService.create({ items: data.items }, data.userId);
  }

  @MessagePattern('order.findById')
  findById(@Payload() data: FindOrderPayload) {
    return this.ordersService.findById(data.id, data.userId);
  }

  @MessagePattern('order.findAllByUser')
  findAllByUser(@Payload() data: FindOrdersByUserPayload) {
    return this.ordersService.findAllByUser(data.userId);
  }
}
