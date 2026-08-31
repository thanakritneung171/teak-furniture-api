import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

export type JwtPayload = { sub: string; role: string };

export type AuthUser = {
  id: string;
  role: string;
  stationId: string | null;
  name: string;
  phone: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-teak-secret-change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException();
    return {
      id: user.id,
      role: user.role,
      stationId: user.stationId,
      name: user.name,
      phone: user.phone,
    };
  }
}
