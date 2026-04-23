import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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

  @ApiOperation({ summary: 'Создать кабинет' })
  @ApiOkResponse({ description: 'Кабинет создан' })
  @Post()
  async create(@Body() body: { name?: string; slug?: string }) {
    try {
      return {
        item: await this.cabinets.createCabinet({
          name: String(body.name ?? ''),
          slug: body.slug,
        }),
      };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }

  @ApiOperation({ summary: 'Обновить кабинет' })
  @ApiOkResponse({ description: 'Кабинет обновлен' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; slug?: string },
  ) {
    try {
      return {
        item: await this.cabinets.updateCabinet({
          id,
          name: body.name,
          slug: body.slug,
        }),
      };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }

  @ApiOperation({ summary: 'Удалить кабинет' })
  @ApiOkResponse({ description: 'Кабинет удален' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      return this.cabinets.deleteCabinet(id);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }
}

