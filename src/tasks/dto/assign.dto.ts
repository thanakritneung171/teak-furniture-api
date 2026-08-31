import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssignDto {
  @ApiProperty({ description: 'user id ของพนักงานที่รับผิดชอบ' })
  @IsString()
  assigneeId!: string;
}
