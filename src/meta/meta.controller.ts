import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MetaService } from './meta.service';

@ApiTags('meta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MetaController {
  constructor(private meta: MetaService) {}

  @Get('stages')
  stages() {
    return this.meta.stages();
  }

  @Get('overview')
  overview() {
    return this.meta.overview();
  }

  @Get('notifications')
  notifications() {
    return this.meta.notifications();
  }
}
