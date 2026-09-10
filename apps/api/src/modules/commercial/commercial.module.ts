import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CONTRACT_STATUSES, contractInputSchema, registryListQuery } from '@ordens/contracts';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { ContractsService } from './contracts.service.js';

const listQuery = registryListQuery.extend({ contractStatus: z.enum(CONTRACT_STATUSES).optional() });
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('comercial')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermission('contract.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.contracts.list(q);
  }

  @Get(':id')
  @RequirePermission('contract.read')
  detail(@Param('id', uuid) id: string) {
    return this.contracts.detail(id);
  }

  @Post()
  @RequirePermission('contract.manage')
  create(@Body(new ZodPipe(contractInputSchema)) body: z.output<typeof contractInputSchema>) {
    return this.contracts.create(body);
  }

  @Put(':id')
  @RequirePermission('contract.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(contractInputSchema)) body: z.output<typeof contractInputSchema>) {
    return this.contracts.update(id, body);
  }
}

@Module({
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class CommercialModule {}
