import { Injectable, NotFoundException } from '@nestjs/common';
import { EventAction } from '@prisma/client';
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

  async createOrder(dto: CreateOrderDto) {
    const count = await this.prisma.order.count();
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
    const customer = await this.prisma.customer.create({
      data: { name: dto.customerName, phone: dto.customerPhone, address: dto.shippingAddress },
    });
    return this.prisma.order.create({
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
  }

  // เพิ่มสินค้า → สร้าง ProductionTask ที่ stage แรก + CREATE event (บรีฟ §8, §22)
  async createProduct(orderId: string, dto: CreateProductDto, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('ไม่พบ Order');
    const firstStage = await this.prisma.workflowStage.findFirst({ orderBy: { sortOrder: 'asc' } });
    if (!firstStage) throw new NotFoundException('ยังไม่ได้ตั้งค่า workflow stage (รัน seed ก่อน)');

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          orderId,
          name: dto.name,
          productType: dto.productType,
          quantity: dto.quantity ?? 1,
          details: dto.details,
        },
      });
      const taskCount = await tx.productionTask.count();
      const taskNumber = `TASK-${String(taskCount + 1).padStart(6, '0')}`;
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
    });
  }
}
