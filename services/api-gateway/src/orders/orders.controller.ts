import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { callService } from '../common/rpc-call.util';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject('ORDER_SERVICE') private readonly orderClient: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Place a new order (triggers the payment flow asynchronously)',
  })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return callService(() =>
      this.orderClient.send('order.create', {
        userId: user.sub,
        items: dto.items,
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: "List the current user's orders" })
  findAll(@CurrentUser() user: JwtPayload) {
    return callService(() =>
      this.orderClient.send('order.findAllByUser', { userId: user.sub }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single order by id' })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return callService(() =>
      this.orderClient.send('order.findById', { id, userId: user.sub }),
    );
  }
}
