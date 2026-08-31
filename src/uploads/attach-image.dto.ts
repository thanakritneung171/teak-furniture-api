import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageOwnerType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class AttachImageDto {
  @ApiProperty({ enum: ImageOwnerType })
  @IsEnum(ImageOwnerType)
  ownerType!: ImageOwnerType;

  @ApiProperty()
  @IsString()
  ownerId!: string;

  @ApiProperty({ example: '/uploads/abc.jpg' })
  @IsString()
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
