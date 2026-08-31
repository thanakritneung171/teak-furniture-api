import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'คุณสมชาย' })
  @IsString()
  customerName!: string;

  @ApiPropertyOptional({ example: '0812345678' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsOptional()
  @IsDateString()
  paidDate?: string;

  @ApiPropertyOptional({ example: '2026-09-05' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber()
  totalPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
