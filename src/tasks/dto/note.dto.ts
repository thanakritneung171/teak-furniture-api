import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

// ใช้กับ timer start/stop และ complete-stage — รองรับการกดตอนออฟไลน์
export class NoteDto {
  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'idempotency key ที่ client สร้าง (กันซิงค์ซ้ำตอนออฟไลน์)' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'เวลาจริงที่กดปุ่ม (ISO) — ใช้ตอนกดออฟไลน์แล้วค่อยซิงค์' })
  @IsOptional()
  @IsISO8601()
  at?: string;
}
