import { Module } from '@nestjs/common';
import { ClientsProviderModule } from '../clients/clients.module';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [ClientsProviderModule],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
