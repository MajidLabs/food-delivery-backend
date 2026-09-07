import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockRepo = {
    create: jest.fn((data) => data),
    save: jest.fn((data) => ({
      id: 'payment-1',
      createdAt: new Date(),
      ...data,
    })),
    findOneBy: jest.fn(),
  };
  const mockOrderEventsClient = { emit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: mockRepo },
        { provide: 'ORDER_EVENTS_CLIENT', useValue: mockOrderEventsClient },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a successful payment and emits payment.completed', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9); // above the simulated failure threshold

    await service.processOrderPayment({
      orderId: 'order-1',
      userId: 'user-1',
      totalAmount: 42,
    });

    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.SUCCESS }),
    );
    expect(mockOrderEventsClient.emit).toHaveBeenCalledWith(
      'payment.completed',
      expect.objectContaining({ orderId: 'order-1', status: 'SUCCESS' }),
    );
  });

  it('records a failed payment and emits payment.failed once retries are exhausted', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01); // always below the failure threshold

    await service.processOrderPayment({
      orderId: 'order-2',
      userId: 'user-1',
      totalAmount: 15,
    });

    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.FAILED }),
    );
    expect(mockOrderEventsClient.emit).toHaveBeenCalledWith(
      'payment.failed',
      expect.objectContaining({ orderId: 'order-2', status: 'FAILED' }),
    );
  });

  describe('findByOrderId', () => {
    it('delegates to the repository', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
      });
      const result = await service.findByOrderId('order-1');
      expect(result?.id).toBe('payment-1');
    });
  });
});
