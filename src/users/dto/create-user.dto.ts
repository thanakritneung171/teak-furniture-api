import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'สมชาย' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '0810000009' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: 'password' })
  @IsString()
  @MinLength(4)
  password!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({ description: 'stage id ที่รับผิดชอบ (เฉพาะ WORKER)' })
  @IsOptional()
  @IsString()
  stationId?: string;
}
