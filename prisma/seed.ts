import { EventAction, FrameSource, PrismaClient, Priority, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const STAGES = [
  { code: 'DESIGN', label: 'ขึ้นแบบ', sortOrder: 1, isTerminal: false },
  { code: 'WAITING', label: 'รอของ', sortOrder: 2, isTerminal: false },
  { code: 'ASSEMBLY', label: 'เก็บงาน', sortOrder: 3, isTerminal: false },
  { code: 'PAINT', label: 'ทำสี', sortOrder: 4, isTerminal: false },
  { code: 'SHIP', label: 'ส่ง', sortOrder: 5, isTerminal: false },
  { code: 'SHIPPED', label: 'ส่งสำเร็จ', sortOrder: 6, isTerminal: true },
];
const ORDERED = [...STAGES].sort((a, b) => a.sortOrder - b.sortOrder);

async function main() {
  // reset (dev only)
  await prisma.taskEvent.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.taskTag.deleteMany();
  await prisma.imageAsset.deleteMany();
  await prisma.productionTask.deleteMany();
  await prisma.product.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.workflowStage.deleteMany();

  // stages
  const stages: Record<string, any> = {};
  for (const s of STAGES) stages[s.code] = await prisma.workflowStage.create({ data: s });

  const pw = await bcrypt.hash('password', 10);

  // users: 1 admin, 1 supervisor, 1 worker per (non-terminal) stage — all password "password"
  const admin = await prisma.user.create({
    data: { name: 'Admin', phone: '0810000000', passwordHash: pw, role: Role.ADMIN },
  });
  const supervisor = await prisma.user.create({
    data: { name: 'หัวหน้าวิชัย', phone: '0810000001', passwordHash: pw, role: Role.SUPERVISOR },
  });
  const workerNames: Record<string, string> = {
    DESIGN: 'สมชาย (ขึ้นแบบ)',
    WAITING: 'มานะ (รอของ)',
    ASSEMBLY: 'อนุชา (เก็บงาน)',
    PAINT: 'แพร (ทำสี)',
    SHIP: 'ตั้ม (ส่ง)',
  };
  const workers: Record<string, any> = {};
  let idx = 2;
  for (const code of ['DESIGN', 'WAITING', 'ASSEMBLY', 'PAINT', 'SHIP']) {
    workers[code] = await prisma.user.create({
      data: {
        name: workerNames[code],
        phone: '081000000' + idx,
        passwordHash: pw,
        role: Role.WORKER,
        stationId: stages[code].id,
      },
    });
    idx += 1;
  }

  // customer + order
  const cust = await prisma.customer.create({
    data: { name: 'คุณสมหญิง', phone: '0899999999', address: 'เชียงใหม่' },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2026-00125',
      customerId: cust.id,
      dueDate: new Date('2026-09-05'),
      totalPrice: 42000,
      shippingAddress: 'เชียงใหม่ 50000',
    },
  });

  let taskSeq = 0;
  async function makeTask(
    name: string,
    type: string,
    qty: number,
    stageCode: string,
    opts: {
      priority?: Priority;
      region?: string;
      color?: string;
      frameSource?: FrameSource;
      dueDate?: Date;
      assigneeCode?: string;
    } = {},
  ) {
    const targetOrder = stages[stageCode].sortOrder;
    const base = new Date(Date.now() - targetOrder * 3600_000); // เก่าไล่ตามขั้นตอน
    const product = await prisma.product.create({
      data: { orderId: order.id, name, productType: type, quantity: qty },
    });
    taskSeq += 1;
    const task = await prisma.productionTask.create({
      data: {
        taskNumber: 'TASK-' + String(taskSeq).padStart(6, '0'),
        productId: product.id,
        currentStageId: stages[stageCode].id,
        priority: opts.priority ?? Priority.NORMAL,
        region: opts.region,
        color: opts.color,
        frameSource: opts.frameSource,
        dueDate: opts.dueDate ?? order.dueDate,
        assigneeId: opts.assigneeCode ? workers[opts.assigneeCode].id : undefined,
      },
    });
    // CREATE at DESIGN
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorId: admin.id,
        action: EventAction.CREATE,
        toStageId: stages['DESIGN'].id,
        detail: 'สร้างงานผลิต',
        createdAt: new Date(base.getTime()),
      },
    });
    // advance through stages up to (not including) the current one, with a session each
    for (let i = 1; i < targetOrder; i += 1) {
      const from = ORDERED[i - 1];
      const to = ORDERED[i];
      const actor = workers[from.code] ?? supervisor;
      const start = new Date(base.getTime() + i * 20 * 60_000);
      const end = new Date(start.getTime() + 45 * 60_000);
      await prisma.workSession.create({
        data: {
          taskId: task.id,
          stageId: stages[from.code].id,
          userId: actor.id,
          startTime: start,
          endTime: end,
          durationSec: 45 * 60,
        },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: task.id,
          actorId: actor.id,
          action: EventAction.STATUS_CHANGE,
          fromStageId: stages[from.code].id,
          toStageId: stages[to.code].id,
          detail: `${from.label} → ${to.label}`,
          createdAt: new Date(end.getTime()),
        },
      });
    }
    await prisma.imageAsset.create({
      data: {
        ownerType: 'PRODUCT',
        ownerId: product.id,
        url: `https://picsum.photos/seed/${product.id}/800/600`,
        isPrimary: true,
      },
    });
    return task;
  }

  await makeTask('เก้าอี้ไม้สักมีแขน', 'เก้าอี้', 1, 'PAINT', {
    priority: Priority.URGENT,
    region: 'เหนือ',
    color: 'Walnut',
    frameSource: FrameSource.IN_HOUSE,
    assigneeCode: 'PAINT',
  });
  await makeTask('โต๊ะไม้สัก 6 ที่นั่ง', 'โต๊ะ', 1, 'PAINT', {
    region: 'เหนือ',
    color: 'Walnut',
    frameSource: FrameSource.IN_HOUSE,
  });
  await makeTask('เก้าอี้ไม้สัก', 'เก้าอี้', 3, 'ASSEMBLY', {
    region: 'กลาง',
    color: 'Natural',
    frameSource: FrameSource.IN_HOUSE,
  });
  await makeTask('ตู้ไม้สัก', 'ตู้', 1, 'WAITING', {
    region: 'ใต้',
    color: 'Dark Brown',
    frameSource: FrameSource.OUTSOURCED,
  });
  await makeTask('ม้านั่งไม้สัก', 'ม้านั่ง', 2, 'DESIGN', { region: 'อีสาน', color: 'Natural' });
  await makeTask('เตียงไม้สัก', 'เตียง', 1, 'PAINT', {
    priority: Priority.URGENT,
    region: 'เหนือ',
    color: 'Black',
    frameSource: FrameSource.IN_HOUSE,
    dueDate: new Date('2026-08-23'), // เกินกำหนด
    assigneeCode: 'PAINT',
  });

  console.log('✓ Seed done — login: 0810000000 (admin) / 0810000004 (worker ทำสี) · password: password');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
