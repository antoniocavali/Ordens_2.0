import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { cursorQuery } from '@ordens/contracts';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { LookupsService } from './lookups.service.js';

const partnerQuery = cursorQuery.extend({
  role: z.enum(['SELLER', 'BUYER', 'CARRIER']),
  contractId: z.uuid().optional(),
});
const farmQuery = cursorQuery.extend({ sellerId: z.uuid({ message: 'Selecione o vendedor primeiro' }) });
const commodityQuery = z.object({ q: z.string().trim().max(120).optional(), contractId: z.uuid().optional() });
const contractQuery = cursorQuery.extend({
  sellerId: z.uuid().optional(),
  buyerId: z.uuid().optional(),
  commodityId: z.uuid().optional(),
});

/** Endpoints de busca para comboboxes (debounce + paginação no cliente). */
@ApiTags('lookups')
@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get('partners')
  @RequirePermission('partner.read')
  partners(@Query(new ZodPipe(partnerQuery)) q: z.infer<typeof partnerQuery>) {
    return this.lookups.partners(q);
  }

  @Get('farms')
  @RequirePermission('farm.read')
  farms(@Query(new ZodPipe(farmQuery)) q: z.infer<typeof farmQuery>) {
    return this.lookups.farms(q);
  }

  @Get('commodities')
  @RequirePermission('commodity.read')
  commodities(@Query(new ZodPipe(commodityQuery)) q: z.infer<typeof commodityQuery>) {
    return this.lookups.commodities(q);
  }

  @Get('units')
  @RequirePermission('commodity.read')
  units() {
    return this.lookups.units();
  }

  @Get('contracts')
  @RequirePermission('contract.read')
  contracts(@Query(new ZodPipe(contractQuery)) q: z.infer<typeof contractQuery>) {
    return this.lookups.contracts(q);
  }
}
