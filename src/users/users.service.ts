import { ConflictException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) throw new ConflictException('เบอร์นี้ถูกใช้แล้ว');
    // PIN ต้องไม่ซ้ำกับผู้ใช้อื่น (login ด้วย PIN อย่างเดียว)
    const actives = await this.prisma.user.findMany({ where: { active: true }, select: { passwordHash: true } });
    for (const u of actives) {
      if (await bcrypt.compare(dto.pin, u.passwordHash)) throw new ConflictException('PIN นี้ถูกใช้แล้ว');
    }
    const passwordHash = await bcrypt.hash(dto.pin, 10);
    const u = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        stationId: dto.role === Role.WORKER ? dto.stationId ?? null : null,
      },
      select: { id: true, name: true, phone: true, role: true, stationId: true },
    });
    return u;
  }

  me(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        station: { select: { id: true, code: true, label: true } },
      },
    });
  }

  list() {
    return this.prisma.user.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        station: { select: { code: true, label: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
