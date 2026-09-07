import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  SafeUser,
} from './interfaces/auth-payloads.interface';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterPayload): Promise<SafeUser> {
    const existing = await this.userRepository.findOneBy({ email: dto.email });
    if (existing) {
      throw new RpcException({
        status: 409,
        message: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.userRepository.save(
      this.userRepository.create({
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
      }),
    );

    this.logger.log(`New user registered: ${user.id}`);
    return this.toSafeUser(user);
  }

  async login(dto: LoginPayload): Promise<LoginResult> {
    const user = await this.userRepository.findOneBy({ email: dto.email });
    if (!user) {
      throw new RpcException({ status: 401, message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new RpcException({ status: 401, message: 'Invalid credentials' });
    }

    const payload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') ?? '3600s',
    });

    return { accessToken, user: this.toSafeUser(user) };
  }

  async findById(id: string): Promise<SafeUser> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException({ status: 404, message: 'User not found' });
    }
    return this.toSafeUser(user);
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt,
    };
  }
}
