// ขั้น 2 ของ pipeline: อ่าน snapshot จาก fetch-trello แล้ว upsert เข้า Prisma แบบ idempotent
// รัน (ปลอดภัย ไม่เขียน DB):  npm run import:trello -- --dry-run
// รันจริง:                    npm run import:trello -- --commit
// ตัวเลือก: --snapshot <dir>  --limit <n>  --with-sessions
//
// หลักการ: idempotent ผ่าน ExternalRef (Trello id → row), ไม่แต่งข้อมูล (จำนวนที่เดา = flag),
// เก็บ raw เสมอ, แมปไม่ได้ปล่อย null + ขึ้นรายงาน. เติม dict คนแล้วรันซ้ำ → backfill actor ที่ว่าง

import * as fs from 'fs';
import * as path from 'path';
import { EventAction, FrameSource, PrismaClient, Priority } from '@prisma/client';
import {
  BOARD_TO_STAGE,
  STAGE_BY_BOARD_NAME,
  StageCode,
  TRELLO_MEMBER_TO_USER_PHONE,
  classifyLabel,
  priorityFromListName,
} from './mapping';
import { parseTitle } from './parse-title';

// โหลด DATABASE_URL จาก .env (Node ≥ 20.6)
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* .env ไม่มีก็ใช้ env ที่ตั้งไว้ */
}

const prisma = new PrismaClient();
const SOURCE = 'trello';

// ---------------- args ----------------
const argv = process.argv.slice(2);
const commit = argv.includes('--commit') && !argv.includes('--dry-run');
const withSessions = argv.includes('--with-sessions');
const limitArg = argv[argv.indexOf('--limit') + 1];
const LIMIT = argv.includes('--limit') && limitArg ? Number(limitArg) : Infinity;
const snapArg = argv[argv.indexOf('--snapshot') + 1];

// ---------------- snapshot ----------------
function resolveSnapshotDir(): string {
  if (argv.includes('--snapshot') && snapArg) return path.resolve(snapArg);
  const base = path.join(process.cwd(), 'data', 'trello');
  if (!fs.existsSync(base)) throw new Error(`ไม่พบโฟลเดอร์ snapshot: ${base} (รัน import:fetch ก่อน)`);
  const dirs = fs
    .readdirSync(base)
    .filter((d) => fs.existsSync(path.join(base, d, 'cards.json')))
    .sort();
  if (!dirs.length) throw new Error(`ไม่มี snapshot ใน ${base}`);
  return path.join(base, dirs[dirs.length - 1]);
}

interface RawCard {
  id: string;
  boardId: string;
  boardName: string;
  stage: StageCode;
  idList: string;
  listName: string | null;
  name: string;
  desc: string | null;
  due: string | null;
  dueComplete: boolean;
  closed: boolean;
  dateLastActivity: string | null;
  labels: { name: string; color: string | null }[];
  members: { fullName: string | null; username: string | null }[];
  attachments: { id: string; url: string; name: string | null; mimeType: string | null }[];
}
interface RawAction {
  id: string;
  type: string;
  date: string;
  cardId: string | null;
  memberCreator: string | null;
  listBefore: string | null;
  listAfter: string | null;
  boardSource: string | null;
  boardTarget: string | null;
  text: string | null;
}

// ---------------- report ----------------
const report = {
  snapshot: '',
  mode: commit ? 'commit' : 'dry-run',
  totals: { cards: 0, imported: 0, skippedExisting: 0, skippedNoStage: 0, errors: 0 },
  events: { create: 0, statusChange: 0, note: 0 },
  lowConfidence: {
    noCustomer: [] as string[],
    noQuantity: [] as string[],
    quantityAssumed: [] as string[],
    noProductType: [] as string[],
  },
  unmappedLabels: {} as Record<string, number>,
  unmappedMembers: {} as Record<string, number>,
  errors: [] as { cardId: string; name: string; error: string }[],
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const suffix = (cardId: string) => cardId.slice(-8).toUpperCase();

// ---------------- ExternalRef helpers ----------------
async function refLookup(externalId: string, entityType: string): Promise<string | null> {
  const r = await prisma.externalRef.findUnique({
    where: { source_externalId_entityType: { source: SOURCE, externalId, entityType } },
  });
  return r?.entityId ?? null;
}
async function refCreate(externalId: string, entityType: string, entityId: string) {
  await prisma.externalRef.create({ data: { source: SOURCE, externalId, entityType, entityId } });
}

async function main() {
  const snapshot = resolveSnapshotDir();
  report.snapshot = snapshot;
  const cards: RawCard[] = JSON.parse(fs.readFileSync(path.join(snapshot, 'cards.json'), 'utf8'));
  const actionsPath = path.join(snapshot, 'actions.json');
  const actions: RawAction[] = fs.existsSync(actionsPath) ? JSON.parse(fs.readFileSync(actionsPath, 'utf8')) : [];

  // actions ต่อ card (เรียงเวลาเก่า→ใหม่)
  const actionsByCard = new Map<string, RawAction[]>();
  for (const a of actions) {
    if (!a.cardId) continue;
    (actionsByCard.get(a.cardId) ?? actionsByCard.set(a.cardId, []).get(a.cardId)!).push(a);
  }
  for (const list of actionsByCard.values()) list.sort((x, y) => x.date.localeCompare(y.date));

  // stages + users จาก DB
  const stages = await prisma.workflowStage.findMany();
  const stageIdByCode = new Map<string, string>(stages.map((s) => [s.code, s.id]));
  if (!stages.length) throw new Error('ยังไม่มี WorkflowStage ใน DB — รัน `npm run seed` ก่อน');

  const users = await prisma.user.findMany({ select: { id: true, phone: true, name: true } });
  const userIdByPhone = new Map<string, string>(users.map((u) => [u.phone, u.id]));

  function mapMember(name?: string | null): string | null {
    if (!name) return null;
    const phone = TRELLO_MEMBER_TO_USER_PHONE[name];
    const id = phone ? userIdByPhone.get(phone) : undefined;
    if (!id) {
      bump(report.unmappedMembers, name);
      return null;
    }
    return id;
  }

  const selected = cards.slice(0, Number.isFinite(LIMIT) ? (LIMIT as number) : undefined);
  report.totals.cards = selected.length;

  for (const card of selected) {
    try {
      await importCard(card, actionsByCard.get(card.id) ?? [], stageIdByCode, userIdByPhone, mapMember);
    } catch (e: any) {
      report.totals.errors++;
      report.errors.push({ cardId: card.id, name: card.name, error: e?.message ?? String(e) });
    }
  }

  writeReport(snapshot);
}

// ---------------- per-card import ----------------
async function importCard(
  card: RawCard,
  cardActions: RawAction[],
  stageIdByCode: Map<string, string>,
  userIdByPhone: Map<string, string>,
  mapMember: (name?: string | null) => string | null,
) {
  const stageId = stageIdByCode.get(card.stage);
  if (!stageId) {
    report.totals.skippedNoStage++;
    return;
  }

  const parsed = parseTitle(card.name);
  const shortId = `#${card.id.slice(-6)}`;
  if (parsed.customer === null) report.lowConfidence.noCustomer.push(`${shortId} ${card.name}`);
  if (parsed.quantity === null) report.lowConfidence.noQuantity.push(`${shortId} ${card.name}`);
  if (parsed.productType === null) report.lowConfidence.noProductType.push(`${shortId} ${card.name}`);

  // labels → color/region/frameSource + custom
  let color: string | undefined;
  let region: string | undefined;
  let frameSource: FrameSource | undefined;
  const customLabels: string[] = [];
  for (const l of card.labels) {
    if (!l.name) continue;
    const d = classifyLabel(l.name);
    if (d.kind === 'color') color = color ?? d.value;
    else if (d.kind === 'region') region = region ?? d.value;
    else if (d.kind === 'frameSource') frameSource = frameSource ?? (d.value as FrameSource);
    else {
      customLabels.push(d.value);
      bump(report.unmappedLabels, d.value);
    }
  }
  if (!color && parsed.colorHint) color = parsed.colorHint;

  // เบอร์/ที่อยู่ จากคอมเมนต์ที่มีเบอร์โทร (ตรวจรายบรรทัด กันไปคว้ารหัสไปรษณีย์ติดมา)
  let phone: string | null = null;
  let address: string | null = null;
  for (const a of cardActions) {
    if (a.type !== 'commentCard' || !a.text) continue;
    let found: string | null = null;
    for (const line of a.text.split(/\r?\n/)) {
      const digits = line.replace(/[\s\-().]/g, '');
      const m = digits.match(/(?<!\d)(0\d{8,9})(?!\d)/); // มือถือ 10 หลัก / บ้าน 9 หลัก
      if (m) {
        found = m[1];
        break;
      }
    }
    if (found) {
      phone = found;
      address = a.text.replace(/```/g, '').trim();
      break;
    }
  }

  // timeline dates
  const createAction = cardActions.find((a) => a.type === 'createCard' || a.type === 'copyCard');
  const earliest = cardActions[0]?.date ?? card.dateLastActivity ?? new Date().toISOString();
  const orderDate = createAction?.date ?? earliest;

  const quantity = parsed.quantity ?? 1;
  if (parsed.quantity === null) report.lowConfidence.quantityAssumed.push(`${shortId} qty=1 · ${card.name}`);

  const assigneeId = mapMember(card.members[0]?.fullName ?? card.members[0]?.username);

  if (!commit) {
    // dry-run: นับ event ที่จะสร้าง โดยไม่แตะ DB
    const existing = await refLookup(card.id, 'task');
    if (existing) report.totals.skippedExisting++;
    else report.totals.imported++;
    countPlannedEvents(cardActions, mapMember);
    return;
  }

  // -------- commit --------
  const existingTask = await refLookup(card.id, 'task');
  if (existingTask) {
    report.totals.skippedExisting++;
    await backfillActors(existingTask, cardActions, mapMember); // เติม actor ที่เคยว่าง
    return;
  }

  // customer (known → merge by name; unknown → per-card)
  const custKnown = !!parsed.customer;
  const custExternalId = custKnown ? `customer:name:${norm(parsed.customer!)}` : `customer:card:${card.id}`;
  let customerId = await refLookup(custExternalId, 'customer');
  if (!customerId) {
    const c = await prisma.customer.create({
      data: { name: parsed.customer ?? 'ไม่ทราบชื่อ (Trello)', phone: phone ?? undefined, address: address ?? undefined },
    });
    customerId = c.id;
    await refCreate(custExternalId, 'customer', customerId);
  } else if (phone || address) {
    // เติมข้อมูลติดต่อถ้า customer เดิมยังว่าง
    const c = await prisma.customer.findUnique({ where: { id: customerId } });
    if (c && (!c.phone || !c.address)) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { phone: c.phone ?? phone ?? undefined, address: c.address ?? address ?? undefined },
      });
    }
  }

  // order (1 ต่อการ์ด)
  const order = await prisma.order.create({
    data: {
      orderNumber: `TRO-${suffix(card.id)}`,
      customerId,
      orderDate: new Date(orderDate),
      dueDate: card.due ? new Date(card.due) : undefined,
      shippingAddress: address ?? undefined,
      note: buildOrderNote(card, parsed),
    },
  });
  await refCreate(card.id, 'order', order.id);

  // product
  const product = await prisma.product.create({
    data: {
      orderId: order.id,
      name: card.name, // raw เต็ม — ไม่ให้ข้อมูลหาย
      productType: parsed.productType ?? undefined,
      quantity,
      details: parsed.dimensions ?? undefined,
      note: buildProductNote(card, parsed, color),
    },
  });
  await refCreate(card.id, 'product', product.id);

  // task ที่ stage ปัจจุบันของการ์ด
  const task = await prisma.productionTask.create({
    data: {
      taskNumber: `TRT-${suffix(card.id)}`,
      productId: product.id,
      currentStageId: stageId,
      priority: priorityFromListName(card.listName) === 'URGENT' ? Priority.URGENT : Priority.NORMAL,
      region: region ?? undefined,
      color: color ?? undefined,
      frameSource: frameSource ?? undefined,
      dueDate: card.due ? new Date(card.due) : undefined,
      assigneeId: assigneeId ?? undefined,
      createdAt: new Date(orderDate),
    },
  });
  await refCreate(card.id, 'task', task.id);

  // custom tags
  for (const value of customLabels) {
    const tag = await prisma.tag.upsert({
      where: { type_value: { type: 'custom', value } },
      create: { type: 'custom', value },
      update: {},
    });
    await prisma.taskTag.upsert({
      where: { taskId_tagId: { taskId: task.id, tagId: tag.id } },
      create: { taskId: task.id, tagId: tag.id },
      update: {},
    });
  }

  // images (attachments/cover)
  let imgOrder = 0;
  for (const att of card.attachments) {
    if (!att.url) continue;
    if (await refLookup(att.id, 'image')) continue;
    const img = await prisma.imageAsset.create({
      data: { ownerType: 'PRODUCT', ownerId: product.id, url: att.url, isPrimary: imgOrder === 0, sortOrder: imgOrder },
    });
    await refCreate(att.id, 'image', img.id);
    imgOrder++;
  }

  // events (timeline)
  await writeEvents(task.id, card, cardActions, stageIdByCode, mapMember, createAction, orderDate, withSessions);

  report.totals.imported++;
}

// ---------------- events ----------------
async function writeEvents(
  taskId: string,
  card: RawCard,
  cardActions: RawAction[],
  stageIdByCode: Map<string, string>,
  mapMember: (name?: string | null) => string | null,
  createAction: RawAction | undefined,
  orderDate: string,
  makeSessions: boolean,
) {
  // CREATE
  const createExternalId = createAction?.id ?? `event:create:${card.id}`;
  if (!(await refLookup(createExternalId, 'event'))) {
    const toName = createAction?.boardTarget ?? 'ขึ้นแบบ';
    const toStageId = stageIdByCode.get(STAGE_BY_BOARD_NAME[toName] ?? 'DESIGN') ?? stageIdByCode.get('DESIGN');
    const ev = await prisma.taskEvent.create({
      data: {
        taskId,
        action: EventAction.CREATE,
        toStageId: toStageId ?? undefined,
        detail: createAction ? 'สร้างงาน (Trello)' : 'นำเข้าจาก Trello (ไม่มีประวัติสร้าง)',
        actorId: mapMember(createAction?.memberCreator) ?? undefined,
        createdAt: new Date(createAction?.date ?? orderDate),
      },
    });
    await refCreate(createExternalId, 'event', ev.id);
    report.events.create++;
  }

  // board moves → STATUS_CHANGE
  let prevStage: StageCode | null = null;
  let prevAt = new Date(createAction?.date ?? orderDate);
  for (const a of cardActions) {
    const isBoardMove = a.type === 'moveCardToBoard' || a.type === 'moveCardFromBoard';
    if (isBoardMove && a.boardTarget) {
      const fromCode = a.boardSource ? STAGE_BY_BOARD_NAME[a.boardSource] : undefined;
      const toCode = STAGE_BY_BOARD_NAME[a.boardTarget];
      if (toCode) {
        if (!(await refLookup(a.id, 'event'))) {
          const ev = await prisma.taskEvent.create({
            data: {
              taskId,
              action: EventAction.STATUS_CHANGE,
              fromStageId: fromCode ? stageIdByCode.get(fromCode) ?? undefined : undefined,
              toStageId: stageIdByCode.get(toCode) ?? undefined,
              detail: `${a.boardSource ?? ''} → ${a.boardTarget}`.trim(),
              actorId: mapMember(a.memberCreator) ?? undefined,
              createdAt: new Date(a.date),
            },
          });
          await refCreate(a.id, 'event', ev.id);
          report.events.statusChange++;
        }
        // derived WorkSession (ออปชั่น): ช่วงเวลาที่อยู่ stage ก่อนหน้า
        if (makeSessions && fromCode) {
          const sessRef = `session:${a.id}`;
          if (!(await refLookup(sessRef, 'workSession'))) {
            const start = prevAt;
            const end = new Date(a.date);
            const durationSec = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
            const stageId = stageIdByCode.get(fromCode);
            const userId = mapMember(a.memberCreator);
            if (stageId && userId) {
              const ws = await prisma.workSession.create({
                data: { taskId, stageId, userId, startTime: start, endTime: end, durationSec, note: 'derived from Trello' },
              });
              await refCreate(sessRef, 'workSession', ws.id);
            }
          }
        }
        prevStage = toCode;
        prevAt = new Date(a.date);
      }
    }

    // comments → NOTE
    if (a.type === 'commentCard' && a.text) {
      if (!(await refLookup(a.id, 'event'))) {
        const actorId = mapMember(a.memberCreator);
        const ev = await prisma.taskEvent.create({
          data: {
            taskId,
            action: EventAction.NOTE,
            note: a.text,
            detail: actorId ? undefined : a.memberCreator ?? undefined, // เก็บชื่อดิบถ้าแมปไม่ได้
            actorId: actorId ?? undefined,
            createdAt: new Date(a.date),
          },
        });
        await refCreate(a.id, 'event', ev.id);
        report.events.note++;
      }
    }
  }
  void prevStage;
}

// เติม actorId ให้ event ที่เคยว่าง (กรณีเติม dict คนแล้วรันซ้ำ)
async function backfillActors(
  taskId: string,
  cardActions: RawAction[],
  mapMember: (name?: string | null) => string | null,
) {
  for (const a of cardActions) {
    const eventId = await refLookup(a.id, 'event');
    if (!eventId) continue;
    const actorId = mapMember(a.memberCreator);
    if (!actorId) continue;
    const ev = await prisma.taskEvent.findUnique({ where: { id: eventId }, select: { actorId: true } });
    if (ev && !ev.actorId) {
      await prisma.taskEvent.update({ where: { id: eventId }, data: { actorId } });
    }
  }
}

function countPlannedEvents(cardActions: RawAction[], mapMember: (name?: string | null) => string | null) {
  report.events.create += 1; // อย่างน้อย 1 CREATE ต่อการ์ด
  for (const a of cardActions) {
    if ((a.type === 'moveCardToBoard' || a.type === 'moveCardFromBoard') && a.boardTarget && STAGE_BY_BOARD_NAME[a.boardTarget]) {
      report.events.statusChange++;
      mapMember(a.memberCreator); // เก็บ member ที่แมปไม่ได้เข้ารายงานตั้งแต่ dry-run
    }
    if (a.type === 'commentCard' && a.text) {
      report.events.note++;
      mapMember(a.memberCreator);
    }
  }
}

// ---------------- notes ----------------
function buildOrderNote(card: RawCard, parsed: ReturnType<typeof parseTitle>): string {
  const parts = [`[Trello] ${card.boardName}/${card.listName ?? ''} · card ${card.id}`];
  if (parsed.channel) parts.push(`ช่องทาง: ${parsed.channel}`);
  if (parsed.code) parts.push(`โค้ด: ${parsed.code}`);
  return parts.join('\n');
}
function buildProductNote(card: RawCard, parsed: ReturnType<typeof parseTitle>, colorFromLabel?: string): string {
  const parts: string[] = [];
  if (parsed.channel) parts.push(`ช่องทาง: ${parsed.channel}`);
  if (parsed.code) parts.push(`โค้ด: ${parsed.code}`);
  if (parsed.colorHint && !colorFromLabel) parts.push(`สี(จากชื่อ): ${parsed.colorHint}`);
  if (card.desc) parts.push(`--- desc ---\n${card.desc}`);
  parts.push(`[Trello raw] ${card.name}`);
  return parts.join('\n');
}

// ---------------- report output ----------------
function writeReport(snapshot: string) {
  const jsonPath = path.join(snapshot, 'import-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const cap = (arr: string[], n = 40) =>
    arr.slice(0, n).map((x) => `- ${x}`).join('\n') + (arr.length > n ? `\n- … อีก ${arr.length - n} รายการ` : '');
  const dict = (m: Record<string, number>, n = 40) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `- ${k} × ${v}`)
      .join('\n') || '- (ไม่มี)';

  const md = `# รายงานนำเข้า Trello → Teak DB

- snapshot: \`${report.snapshot}\`
- โหมด: **${report.mode}**${commit ? '' : '  (ยังไม่เขียน DB)'}

## สรุป
| รายการ | จำนวน |
|---|---|
| การ์ดที่ประมวลผล | ${report.totals.cards} |
| นำเข้าใหม่ | ${report.totals.imported} |
| ข้าม (มีอยู่แล้ว) | ${report.totals.skippedExisting} |
| ข้าม (ไม่มี stage) | ${report.totals.skippedNoStage} |
| ผิดพลาด | ${report.totals.errors} |
| event: CREATE / STATUS / NOTE | ${report.events.create} / ${report.events.statusChange} / ${report.events.note} |

## ต้องรีวิว (parse ไม่มั่นใจ)
### จำนวนถูกตั้งเป็น 1 (อ่านจำนวนไม่ได้) — ${report.lowConfidence.quantityAssumed.length}
${cap(report.lowConfidence.quantityAssumed)}

### แยกชื่อลูกค้าไม่ได้ — ${report.lowConfidence.noCustomer.length}
${cap(report.lowConfidence.noCustomer)}

### ไม่รู้ประเภทสินค้า — ${report.lowConfidence.noProductType.length}
${cap(report.lowConfidence.noProductType)}

## Label ที่ยังไม่รู้จัก (เก็บเป็น custom tag) — เติมใน mapping.ts ได้
${dict(report.unmappedLabels)}

## คน (member/ผู้คอมเมนต์) ที่ยังแมปไม่ได้ — เติม TRELLO_MEMBER_TO_USER_PHONE แล้วรันซ้ำ
${dict(report.unmappedMembers)}

${report.errors.length ? `## ผิดพลาด\n${report.errors.slice(0, 40).map((e) => `- ${e.cardId} · ${e.error}`).join('\n')}` : ''}
`;
  const mdPath = path.join(snapshot, 'import-report.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `\n${commit ? '✓ committed' : '✓ dry-run'} — cards ${report.totals.cards}, imported ${report.totals.imported}, ` +
      `skipped ${report.totals.skippedExisting}, errors ${report.totals.errors}\n  report → ${mdPath}`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('import-trello failed:', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
