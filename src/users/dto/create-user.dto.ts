import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'สมชาย' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '0810000009' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: '100009', description: 'PIN 6 หลัก (ใช้ login)' })
  @Matches(/^\d{6}$/, { message: 'PIN ต้องเป็นตัวเลข 6 หลัก' })
  pin!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({ description: 'stage id ที่รับผิดชอบ (เฉพาะ WORKER)' })
  @IsOptional()
  @IsString()
  stationId?: string;
}
