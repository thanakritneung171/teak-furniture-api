import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      include: { station: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('เบอร์หรือรหัสไม่ถูกต้อง');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('เบอร์หรือรหัสไม่ถูกต้อง');

    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        station: user.station
          ? { id: user.station.id, code: user.station.code, label: user.station.label }
          : null,
      },
    };
  }
}
