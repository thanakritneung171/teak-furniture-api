import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AttachImageDto } from './attach-image.dto';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class UploadsController {
  constructor(private prisma: PrismaService) {}

  // อัปโหลดไฟล์รูป → เก็บลง uploads/ แล้วคืน url (relative)
  @Post('uploads')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: { originalname?: string; buffer?: Buffer } | undefined) {
    if (!file || !file.buffer) throw new BadRequestException('ไม่มีไฟล์');
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const ext = extname(file.originalname || '') || '.jpg';
    const name = `${randomUUID()}${ext}`;
    writeFileSync(join(UPLOAD_DIR, name), file.buffer);
    return { url: `/uploads/${name}` };
  }

  // ผูกรูปเข้ากับ order/product/task
  @Post('images')
  attach(@Body() dto: AttachImageDto) {
    return this.prisma.imageAsset.create({
      data: {
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        url: dto.url,
        isPrimary: !!dto.isPrimary,
      },
    });
  }
}
