import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((data) => data),
    save: jest.fn((data) => ({ id: 'uuid-1', createdAt: new Date(), ...data })),
  };
  const mockJwt = {
    signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
  };
  const mockConfig = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? 'test-secret' : '3600s',
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('creates a new user with a hashed password and never leaks it', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);
      const result = await service.register({
        email: 'a@test.com',
        password: 'password123',
        fullName: 'A B',
      });

      expect(result.email).toBe('a@test.com');
      expect(result).not.toHaveProperty('passwordHash');
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('throws a 409 RpcException when the email is already registered', async () => {
      mockRepo.findOneBy.mockResolvedValue({ id: 'existing' });
      await expect(
        service.register({
          email: 'a@test.com',
          password: 'password123',
          fullName: 'A B',
        }),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('login', () => {
    it('returns an access token for valid credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockRepo.findOneBy.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@test.com',
        passwordHash,
        fullName: 'A B',
        createdAt: new Date(),
      });

      const result = await service.login({
        email: 'a@test.com',
        password: 'password123',
      });
      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.user.email).toBe('a@test.com');
    });

    it('throws a 401 RpcException for an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockRepo.findOneBy.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@test.com',
        passwordHash,
        fullName: 'A B',
      });

      await expect(
        service.login({ email: 'a@test.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('throws a 401 RpcException when the user does not exist', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@test.com', password: 'x' }),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('findById', () => {
    it('returns the safe user representation', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@test.com',
        fullName: 'A B',
        createdAt: new Date(),
      });
      const result = await service.findById('uuid-1');
      expect(result.id).toBe('uuid-1');
    });

    it('throws a 404 RpcException when the user is missing', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        RpcException,
      );
    });
  });
});
