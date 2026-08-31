import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
