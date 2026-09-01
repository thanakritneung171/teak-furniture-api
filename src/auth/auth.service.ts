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
    // login ด้วย PIN 6 หลักอย่างเดียว — หา user ที่ PIN ตรง (จำนวนผู้ใช้ในโรงงานไม่มาก)
    const users = await this.prisma.user.findMany({
      where: { active: true },
      include: { station: true },
    });
    let user: (typeof users)[number] | null = null;
    for (const u of users) {
      if (await bcrypt.compare(dto.pin, u.passwordHash)) {
        user = u;
        break;
      }
    }
    if (!user) throw new UnauthorizedException('PIN ไม่ถูกต้อง');

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
