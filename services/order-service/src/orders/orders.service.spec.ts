import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RedisService } from '../redis/redis.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockRepo = {
    create: jest.fn((data) => data),
    save: jest.fn((data) => ({
      id: 'order-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      status: OrderStatus.PENDING,
      ...data,
    })),
    findOneBy: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };
  const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const mockPaymentEventsClient = { emit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: mockRepo },
        { provide: RedisService, useValue: mockRedis },
        { provide: 'PAYMENT_EVENTS_CLIENT', useValue: mockPaymentEventsClient },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  describe('create', () => {
    it('computes the total, persists the order and emits order.created', async () => {
      const order = await service.create(
        {
          items: [
            { name: 'Pizza', quantity: 2, price: 10 },
            { name: 'Soda', quantity: 1, price: 3 },
          ],
        },
        'user-1',
      );

      expect(order.totalAmount).toBe(23);
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockPaymentEventsClient.emit).toHaveBeenCalledWith(
        'order.created',
        expect.objectContaining({
          orderId: order.id,
          userId: 'user-1',
          totalAmount: 23,
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns the cached order on a cache hit without touching the database', async () => {
      mockRedis.get.mockResolvedValue({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PENDING,
      });
      const order = await service.findById('order-1', 'user-1');
      expect(order.id).toBe('order-1');
      expect(mockRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('falls back to the database on a cache miss and repopulates the cache', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRepo.findOneBy.mockResolvedValue({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PENDING,
      });
      const order = await service.findById('order-1', 'user-1');
      expect(order.id).toBe('order-1');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('throws a 403 RpcException when another user requests the order', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRepo.findOneBy.mockResolvedValue({
        id: 'order-1',
        userId: 'someone-else',
      });
      await expect(
        service.findById('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('throws a 404 RpcException when the order does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.findById('missing', 'user-1'),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('updateStatusFromPayment', () => {
    it('updates the order status and invalidates the cache', async () => {
      await service.updateStatusFromPayment('order-1', OrderStatus.CONFIRMED);
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'order-1' },
        { status: OrderStatus.CONFIRMED },
      );
      expect(mockRedis.del).toHaveBeenCalledWith('order:order-1');
    });
  });
});
