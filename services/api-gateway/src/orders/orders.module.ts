import { Module } from '@nestjs/common';
import { ClientsProviderModule } from '../clients/clients.module';
import { OrdersController } from './orders.controller';

@Module({
  imports: [ClientsProviderModule],
  controllers: [OrdersController],
})
export class OrdersModule {}
