import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class TaskQueryDto {
  @ApiPropertyOptional({ description: 'กรองตามรหัส stage เช่น PAINT' })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ description: "true = เฉพาะงานด่วน" })
  @IsOptional()
  @IsString()
  urgent?: string;

  @ApiPropertyOptional({ description: 'true = เฉพาะงานเกินกำหนด' })
  @IsOptional()
  @IsString()
  delayed?: string;

  @ApiPropertyOptional({ description: 'กรองตามผู้รับผิดชอบ' })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
