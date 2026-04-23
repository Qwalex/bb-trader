import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CabinetService } from './cabinet.service';

@ApiTags('Cabinets')
@Controller('cabinets')
export class CabinetController {
  constructor(private readonly cabinets: CabinetService) {}

  private userIdFromReq(req: {
    auth?: { userId?: string };
  }): string | null {
    const userId = String(req.auth?.userId ?? '').trim();
    return userId || null;
  }

  @ApiOperation({ summary: 'Список кабинетов' })
  @ApiOkResponse({ description: 'Кабинеты получены' })
  @Get()
  async list(@Req() req: { auth?: { userId?: string } }) {
    return { items: await this.cabinets.listCabinetsForUser(this.userIdFromReq(req)) };
  }

  @ApiOperation({ summary: 'Создать кабинет' })
  @ApiOkResponse({ description: 'Кабинет создан' })
  @Post()
  async create(
    @Req() req: { auth?: { userId?: string } },
    @Body() body: { name?: string; slug?: string },
  ) {
    try {
      return {
        item: await this.cabinets.createCabinet({
          ownerUserId: this.userIdFromReq(req),
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
    @Req() req: { auth?: { userId?: string } },
    @Param('id') id: string,
    @Body() body: { name?: string; slug?: string },
  ) {
    try {
      return {
        item: await this.cabinets.updateCabinet({
          ownerUserId: this.userIdFromReq(req),
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
  async remove(
    @Req() req: { auth?: { userId?: string } },
    @Param('id') id: string,
  ) {
    try {
      return this.cabinets.deleteCabinet(id, this.userIdFromReq(req));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }
}

