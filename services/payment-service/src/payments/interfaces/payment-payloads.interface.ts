export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  totalAmount: number;
}

export interface FindPaymentByOrderPayload {
  orderId: string;
}
