import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  LoginPayload,
  RegisterPayload,
} from './interfaces/auth-payloads.interface';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('auth.register')
  register(@Payload() dto: RegisterPayload) {
    return this.authService.register(dto);
  }

  @MessagePattern('auth.login')
  login(@Payload() dto: LoginPayload) {
    return this.authService.login(dto);
  }

  @MessagePattern('user.findById')
  findById(@Payload() data: { id: string }) {
    return this.authService.findById(data.id);
  }
}
