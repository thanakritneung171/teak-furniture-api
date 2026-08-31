import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const cardInclude = {
  currentStage: true,
  product: { include: { order: { select: { orderNumber: true } } } },
} as const;

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  stages() {
    return this.prisma.workflowStage.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, label: true, sortOrder: true, isTerminal: true },
    });
  }

  // KPI ภาพรวมการผลิต (บรีฟ §17)
  async overview() {
    const stages = await this.prisma.workflowStage.findMany({ orderBy: { sortOrder: 'asc' } });
    const grouped = await this.prisma.productionTask.groupBy({
      by: ['currentStageId'],
      _count: { _all: true },
    });
    const byStage = stages.map((s) => ({
      code: s.code,
      label: s.label,
      sortOrder: s.sortOrder,
      count: grouped.find((g) => g.currentStageId === s.id)?._count._all ?? 0,
    }));
    const total = byStage.reduce((a, b) => a + b.count, 0);
    const shipped = byStage.find((s) => s.code === 'SHIPPED')?.count ?? 0;
    const delayed = await this.prisma.productionTask.count({
      where: { dueDate: { lt: new Date() }, currentStage: { isTerminal: false } },
    });
    const unassigned = await this.prisma.productionTask.count({
      where: { assigneeId: null, currentStage: { isTerminal: false } },
    });
    return { total, inProduction: total - shipped, shipped, delayed, unassigned, byStage };
  }

  // แจ้งเตือน = alert ที่คำนวณสด (เกินกำหนด + งานด่วนไม่มีผู้รับผิดชอบ) (บรีฟ §18)
  async notifications() {
    const now = new Date();
    const overdue = await this.prisma.productionTask.findMany({
      where: { dueDate: { lt: now }, currentStage: { isTerminal: false } },
      include: cardInclude,
      orderBy: { dueDate: 'asc' },
    });
    const urgentUnassigned = await this.prisma.productionTask.findMany({
      where: { priority: 'URGENT', assigneeId: null, currentStage: { isTerminal: false } },
      include: cardInclude,
    });
    const items = [
      ...overdue.map((t) => ({
        type: 'overdue',
        taskId: t.id,
        title: t.product.name,
        message: `เกินกำหนดส่ง (${t.currentStage.label})`,
        orderNumber: t.product.order.orderNumber,
        dueDate: t.dueDate,
      })),
      ...urgentUnassigned.map((t) => ({
        type: 'urgent_unassigned',
        taskId: t.id,
        title: t.product.name,
        message: `งานด่วนยังไม่มีผู้รับผิดชอบ (${t.currentStage.label})`,
        orderNumber: t.product.order.orderNumber,
        dueDate: t.dueDate,
      })),
    ];
    return { count: items.length, items };
  }
}
