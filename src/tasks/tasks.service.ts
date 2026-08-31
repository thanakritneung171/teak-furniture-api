import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/jwt.strategy';
import { TaskQueryDto } from './dto/task-query.dto';

// ข้อมูลที่ดึงมาต่อ 1 การ์ด task
const cardInclude = {
  currentStage: true,
  assignee: { select: { id: true, name: true } },
  product: { include: { order: { select: { orderNumber: true, dueDate: true } } } },
  workSessions: { where: { endTime: null }, take: 1 },
} as const;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  // แปลง task → การ์ดสำหรับ list/board/home
  private toCard(task: any) {
    const running = task.workSessions?.find((s: any) => s.endTime === null) ?? null;
    return {
      id: task.id,
      taskNumber: task.taskNumber,
      productName: task.product.name,
      productType: task.product.productType,
      quantity: task.product.quantity,
      orderNumber: task.product.order.orderNumber,
      stage: { code: task.currentStage.code, label: task.currentStage.label },
      region: task.region,
      color: task.color,
      frameSource: task.frameSource,
      priority: task.priority,
      dueDate: task.dueDate,
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      running: !!running,
      runningSince: running?.startTime ?? null,
      elapsedSec: running
        ? Math.floor((Date.now() - new Date(running.startTime).getTime()) / 1000)
        : null,
    };
  }

  // "งานของฉัน" (บรีฟ §16) — WORKER เห็นเฉพาะ stage ของตัวเอง
  async myWork(user: AuthUser) {
    const where =
      user.role === 'WORKER' && user.stationId
        ? { currentStageId: user.stationId }
        : { currentStage: { isTerminal: false } };

    const tasks = await this.prisma.productionTask.findMany({
      where,
      include: cardInclude,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const cards = tasks.map((t) => this.toCard(t));
    const inProgress = cards.filter((c) => c.running);
    const waiting = cards.filter((c) => !c.running);
    const urgent = cards.filter((c) => c.priority === 'URGENT');

    const done = await this.prisma.taskEvent.count({
      where: { actorId: user.id, action: EventAction.STATUS_CHANGE, createdAt: { gte: startOfToday() } },
    });

    return {
      counts: { inProgress: inProgress.length, waiting: waiting.length, done },
      urgent,
      inProgress,
      waiting,
    };
  }

  // รายการ task + filter/sort (บรีฟ §4.2)
  async list(q: TaskQueryDto) {
    const where: any = {};
    if (q.stage) where.currentStage = { code: q.stage };
    if (q.urgent === 'true') where.priority = 'URGENT';
    if (q.delayed === 'true') where.dueDate = { lt: new Date() };
    if (q.assigneeId) where.assigneeId = q.assigneeId;

    const tasks = await this.prisma.productionTask.findMany({
      where,
      include: cardInclude,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    return tasks.map((t) => this.toCard(t));
  }

  // kanban แยกตาม stage (บรีฟ §4.3)
  async board() {
    const stages = await this.prisma.workflowStage.findMany({ orderBy: { sortOrder: 'asc' } });
    const tasks = await this.prisma.productionTask.findMany({ include: cardInclude });
    const cards = tasks.map((t) => this.toCard(t));
    return stages.map((s) => ({
      stage: { code: s.code, label: s.label, sortOrder: s.sortOrder },
      tasks: cards.filter((c) => c.stage.code === s.code),
    }));
  }

  // รายละเอียด task — รูป, tag, timeline, session ปัจจุบัน
  async detail(id: string) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id },
      include: {
        currentStage: true,
        assignee: { select: { id: true, name: true } },
        product: { include: { order: { include: { customer: true } } } },
        workSessions: {
          orderBy: { startTime: 'asc' },
          include: { user: { select: { id: true, name: true } }, stage: true },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true } }, fromStage: true, toStage: true },
        },
      },
    });
    if (!task) throw new NotFoundException('ไม่พบงาน');

    const stages = await this.prisma.workflowStage.findMany({ orderBy: { sortOrder: 'asc' } });
    const images = await this.prisma.imageAsset.findMany({
      where: { ownerType: 'PRODUCT', ownerId: task.productId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });

    const timeline = stages.map((s) => {
      const entered = [...task.events].reverse().find((e) => e.toStageId === s.id);
      const status =
        task.currentStage.sortOrder > s.sortOrder
          ? 'done'
          : task.currentStage.sortOrder === s.sortOrder
            ? 'current'
            : 'pending';
      return {
        code: s.code,
        label: s.label,
        sortOrder: s.sortOrder,
        status,
        at: entered?.createdAt ?? null,
        by: entered?.actor?.name ?? null,
      };
    });

    const running = task.workSessions.find((s) => s.endTime === null) ?? null;
    const totalDurationSec = task.workSessions.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);

    return {
      id: task.id,
      taskNumber: task.taskNumber,
      priority: task.priority,
      region: task.region,
      color: task.color,
      frameSource: task.frameSource,
      dueDate: task.dueDate,
      stage: { code: task.currentStage.code, label: task.currentStage.label, isTerminal: task.currentStage.isTerminal },
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      product: {
        id: task.product.id,
        name: task.product.name,
        productType: task.product.productType,
        quantity: task.product.quantity,
        details: task.product.details,
      },
      order: {
        id: task.product.order.id,
        orderNumber: task.product.order.orderNumber,
        dueDate: task.product.order.dueDate,
        customer: task.product.order.customer
          ? { name: task.product.order.customer.name, phone: task.product.order.customer.phone }
          : null,
        shippingAddress: task.product.order.shippingAddress,
      },
      images: images.map((i) => ({ id: i.id, url: i.url, isPrimary: i.isPrimary })),
      timeline,
      sessions: task.workSessions.map((s) => ({
        id: s.id,
        stage: s.stage.label,
        by: s.user.name,
        startTime: s.startTime,
        endTime: s.endTime,
        durationSec: s.durationSec,
      })),
      running: running
        ? {
            sessionId: running.id,
            startTime: running.startTime,
            elapsedSec: Math.floor((Date.now() - new Date(running.startTime).getTime()) / 1000),
          }
        : null,
      totalDurationSec,
    };
  }

  // เริ่มจับเวลา (บรีฟ §11) — 1 running session ต่อ task
  async timerStart(taskId: string, userId: string) {
    const task = await this.prisma.productionTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('ไม่พบงาน');
    const existing = await this.prisma.workSession.findFirst({ where: { taskId, endTime: null } });
    if (existing) throw new BadRequestException('มี timer ที่กำลังทำงานอยู่แล้ว');

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.workSession.create({
        data: { taskId, stageId: task.currentStageId, userId, startTime: new Date() },
      });
      if (!task.assigneeId) {
        await tx.productionTask.update({ where: { id: taskId }, data: { assigneeId: userId } });
      }
      await tx.taskEvent.create({
        data: { taskId, actorId: userId, action: EventAction.TIMER_START, toStageId: task.currentStageId, detail: 'เริ่มจับเวลา' },
      });
      return session;
    });
  }

  // หยุดจับเวลา (บรีฟ §12) → ปิด session + คำนวณ duration
  async timerStop(taskId: string, userId: string, note?: string) {
    const session = await this.prisma.workSession.findFirst({
      where: { taskId, endTime: null },
      orderBy: { startTime: 'desc' },
    });
    if (!session) throw new BadRequestException('ไม่มี timer ที่กำลังทำงาน');

    const end = new Date();
    const durationSec = Math.max(0, Math.floor((end.getTime() - new Date(session.startTime).getTime()) / 1000));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workSession.update({
        where: { id: session.id },
        data: { endTime: end, durationSec, note },
      });
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: userId,
          action: EventAction.TIMER_STOP,
          toStageId: session.stageId,
          detail: `หยุดจับเวลา ${Math.round(durationSec / 60)} นาที`,
          note,
        },
      });
      return updated;
    });
  }

  // เสร็จขั้นตอน (บรีฟ §13) — ปิด session ที่ค้าง, เขียน audit, เลื่อน stage
  async completeStage(taskId: string, userId: string, note?: string) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id: taskId },
      include: { currentStage: true },
    });
    if (!task) throw new NotFoundException('ไม่พบงาน');
    if (task.currentStage.isTerminal) throw new BadRequestException('งานอยู่ขั้นตอนสุดท้ายแล้ว');
    const next = await this.prisma.workflowStage.findFirst({
      where: { sortOrder: { gt: task.currentStage.sortOrder } },
      orderBy: { sortOrder: 'asc' },
    });
    if (!next) throw new BadRequestException('ไม่มีขั้นตอนถัดไป');

    return this.prisma.$transaction(async (tx) => {
      const running = await tx.workSession.findFirst({
        where: { taskId, endTime: null },
        orderBy: { startTime: 'desc' },
      });
      if (running) {
        const end = new Date();
        const durationSec = Math.max(0, Math.floor((end.getTime() - new Date(running.startTime).getTime()) / 1000));
        await tx.workSession.update({ where: { id: running.id }, data: { endTime: end, durationSec, note } });
        await tx.taskEvent.create({
          data: {
            taskId,
            actorId: userId,
            action: EventAction.TIMER_STOP,
            toStageId: task.currentStageId,
            detail: `หยุดจับเวลา ${Math.round(durationSec / 60)} นาที`,
          },
        });
      }
      const updated = await tx.productionTask.update({
        where: { id: taskId },
        data: { currentStageId: next.id },
      });
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: userId,
          action: EventAction.STATUS_CHANGE,
          fromStageId: task.currentStageId,
          toStageId: next.id,
          detail: `${task.currentStage.label} → ${next.label}`,
          note,
        },
      });
      return updated;
    });
  }

  // ประวัติ task (บรีฟ §14)
  async history(taskId: string) {
    const events = await this.prisma.taskEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { name: true } }, fromStage: true, toStage: true },
    });
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      at: e.createdAt,
      by: e.actor?.name ?? null,
      from: e.fromStage?.label ?? null,
      to: e.toStage?.label ?? null,
      detail: e.detail,
      note: e.note,
    }));
  }

  // มอบหมายงานให้พนักงาน (บรีฟ §15 supervisor) + audit
  async assign(taskId: string, assigneeId: string, actorId: string) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id: taskId },
      include: { currentStage: true },
    });
    if (!task) throw new NotFoundException('ไม่พบงาน');
    const user = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!user) throw new NotFoundException('ไม่พบพนักงาน');

    const updated = await this.prisma.productionTask.update({
      where: { id: taskId },
      data: { assigneeId },
    });
    await this.prisma.taskEvent.create({
      data: {
        taskId,
        actorId,
        action: EventAction.ASSIGN,
        toStageId: task.currentStageId,
        detail: `มอบหมายให้ ${user.name}`,
      },
    });
    return updated;
  }
}
