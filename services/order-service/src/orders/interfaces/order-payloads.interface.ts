import { OrderItem } from '../entities/order.entity';

export interface CreateOrderPayload {
  userId: string;
  items: OrderItem[];
}

export interface FindOrderPayload {
  id: string;
  userId: string;
}

export interface FindOrdersByUserPayload {
  userId: string;
}

export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  totalAmount: number;
}

export interface PaymentCompletedEvent {
  orderId: string;
  paymentId: string;
  status: 'SUCCESS';
}

export interface PaymentFailedEvent {
  orderId: string;
  paymentId: string;
  status: 'FAILED';
  reason: string;
}
