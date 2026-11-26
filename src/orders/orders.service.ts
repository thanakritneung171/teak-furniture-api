import { Injectable, NotFoundException } from '@nestjs/common';
import { EventAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        products: { include: { tasks: { include: { currentStage: true } } } },
      },
    });
  }

  async get(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        products: {
          include: { tasks: { include: { currentStage: true, assignee: { select: { id: true, name: true } } } } },
        },
      },
    });
    if (!order) throw new NotFoundException('ไม่พบ Order');
    return order;
  }

  // เลขถัดไป = เลขสูงสุดที่มีอยู่ของ prefix นี้ + 1 (ไม่ใช้ count — count ชนเลขเดิมได้เมื่อมีการลบ,
  // seed ที่ตั้งเลขเอง หรือ order/task ที่ import จาก Trello ซึ่งใช้ prefix อื่น)
  private async nextNumber(
    client: Prisma.TransactionClient,
    kind: 'order' | 'task',
    prefix: string,
    width: number,
  ): Promise<string> {
    // เลขเติม 0 ความกว้างคงที่ → เรียงแบบ string desc ได้เลขสูงสุด
    const last =
      kind === 'order'
        ? (
            await client.order.findFirst({
              where: { orderNumber: { startsWith: prefix } },
              orderBy: { orderNumber: 'desc' },
              select: { orderNumber: true },
            })
          )?.orderNumber
        : (
            await client.productionTask.findFirst({
              where: { taskNumber: { startsWith: prefix } },
              orderBy: { taskNumber: 'desc' },
              select: { taskNumber: true },
            })
          )?.taskNumber;
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(width, '0')}`;
  }

  // กันกรณีกดพร้อมกันจนเลขชน (unique) → ลองใหม่สูงสุด 3 ครั้ง
  private async withRetryOnUniqueConflict<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  async createOrder(dto: CreateOrderDto) {
    return this.withRetryOnUniqueConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const orderNumber = await this.nextNumber(tx, 'order', `ORD-${new Date().getFullYear()}-`, 5);
        const customer = await tx.customer.create({
          data: { name: dto.customerName, phone: dto.customerPhone, address: dto.shippingAddress },
        });
        return tx.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            paidDate: dto.paidDate ? new Date(dto.paidDate) : undefined,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            totalPrice: dto.totalPrice,
            shippingAddress: dto.shippingAddress,
            note: dto.note,
          },
          include: { customer: true },
        });
      }),
    );
  }

  // เพิ่มสินค้า → สร้าง ProductionTask ที่ stage แรก + CREATE event (บรีฟ §8, §22)
  async createProduct(orderId: string, dto: CreateProductDto, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('ไม่พบ Order');
    const firstStage = await this.prisma.workflowStage.findFirst({ orderBy: { sortOrder: 'asc' } });
    if (!firstStage) throw new NotFoundException('ยังไม่ได้ตั้งค่า workflow stage (รัน seed ก่อน)');

    return this.withRetryOnUniqueConflict(() => this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          orderId,
          name: dto.name,
          productType: dto.productType,
          quantity: dto.quantity ?? 1,
          details: dto.details,
        },
      });
      const taskNumber = await this.nextNumber(tx, 'task', 'TASK-', 6);
      const task = await tx.productionTask.create({
        data: {
          taskNumber,
          productId: product.id,
          currentStageId: firstStage.id,
          priority: dto.priority ?? undefined,
          region: dto.region,
          color: dto.color,
          frameSource: dto.frameSource,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : order.dueDate ?? undefined,
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          actorId,
          action: EventAction.CREATE,
          toStageId: firstStage.id,
          detail: 'สร้างงานผลิต',
        },
      });
      return { product, task };
    }));
  }
}
