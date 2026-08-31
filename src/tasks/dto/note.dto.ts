import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class NoteDto {
  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  note?: string;
}
