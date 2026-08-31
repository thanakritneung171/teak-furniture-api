import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login ด้วยเบอร์โทร + รหัส → JWT' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
