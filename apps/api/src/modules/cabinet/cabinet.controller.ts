import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CabinetService } from './cabinet.service';

@ApiTags('Cabinets')
@Controller('cabinets')
export class CabinetController {
  constructor(private readonly cabinets: CabinetService) {}

  @ApiOperation({ summary: 'Список кабинетов' })
  @ApiOkResponse({ description: 'Кабинеты получены' })
  @Get()
  async list() {
    return { items: await this.cabinets.listCabinets() };
  }
}

