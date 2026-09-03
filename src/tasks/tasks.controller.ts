import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt.strategy';
import { TasksService } from './tasks.service';
import { TaskQueryDto } from './dto/task-query.dto';
import { NoteDto } from './dto/note.dto';
import { AssignDto } from './dto/assign.dto';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasks: TasksService) {}

  // literal routes ก่อน :id
  @Get('my')
  @ApiOperation({ summary: 'งานของฉัน (ตาม role/station)' })
  my(@CurrentUser() user: AuthUser) {
    return this.tasks.myWork(user);
  }

  @Get('board')
  @ApiOperation({ summary: 'Task board (kanban แยกตาม stage)' })
  board() {
    return this.tasks.board();
  }

  @Get()
  @ApiOperation({ summary: 'รายการ task + filter' })
  list(@Query() q: TaskQueryDto) {
    return this.tasks.list(q);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.tasks.detail(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.tasks.history(id);
  }

  @Post(':id/timer/start')
  @ApiOperation({ summary: 'เริ่มจับเวลา' })
  timerStart(@Param('id') id: string, @Body() dto: NoteDto, @CurrentUser() user: AuthUser) {
    return this.tasks.timerStart(id, user.id, { clientId: dto.clientId, at: dto.at });
  }

  @Post(':id/timer/stop')
  @ApiOperation({ summary: 'หยุดจับเวลา' })
  timerStop(@Param('id') id: string, @Body() dto: NoteDto, @CurrentUser() user: AuthUser) {
    return this.tasks.timerStop(id, user.id, dto.note, { clientId: dto.clientId, at: dto.at });
  }

  @Patch(':id/complete-stage')
  @ApiOperation({ summary: 'เสร็จขั้นตอน → เลื่อน workflow ไปขั้นถัดไป' })
  completeStage(@Param('id') id: string, @Body() dto: NoteDto, @CurrentUser() user: AuthUser) {
    return this.tasks.completeStage(id, user.id, dto.note, { clientId: dto.clientId, at: dto.at });
  }

  @Patch(':id/assign')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'มอบหมายงานให้พนักงาน' })
  assign(@Param('id') id: string, @Body() dto: AssignDto, @CurrentUser() user: AuthUser) {
    return this.tasks.assign(id, dto.assigneeId, user.id);
  }
}
