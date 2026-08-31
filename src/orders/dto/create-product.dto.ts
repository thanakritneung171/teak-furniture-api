import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FrameSource, Priority } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

// เพิ่มสินค้าเข้า Order → ระบบสร้าง ProductionTask ให้อัตโนมัติ (พร้อม tag)
export class CreateProductDto {
  @ApiProperty({ example: 'เก้าอี้ไม้สักมีแขน' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'เก้าอี้' })
  @IsOptional()
  @IsString()
  productType?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: 'เหนือ', description: 'ภาค' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Walnut', description: 'สี' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ enum: FrameSource, description: 'แหล่งโครง' })
  @IsOptional()
  @IsEnum(FrameSource)
  frameSource?: FrameSource;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: '2026-09-05' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
