import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '100005', description: 'PIN 6 หลัก' })
  @Matches(/^\d{6}$/, { message: 'PIN ต้องเป็นตัวเลข 6 หลัก' })
  pin!: string;
}
