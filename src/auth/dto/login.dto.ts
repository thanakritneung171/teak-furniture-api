import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '0810000001', description: 'เบอร์โทรที่ใช้ login' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: 'password' })
  @IsString()
  @MinLength(1)
  password!: string;
}
