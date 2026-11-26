// ขั้น 1 ของ pipeline: ดึงข้อมูล Trello (อ่านอย่างเดียว ไม่แก้ Trello) แล้วเขียน snapshot ลงดิสก์
// รัน: npm run import:fetch   (ต้องมี TRELLO_KEY / TRELLO_TOKEN ใน env หรือ .env)
//
// ผลลัพธ์: data/trello/<timestamp>/{cards.json, actions.json, manifest.json}
// - ดึงทั้ง 6 บอร์ดการผลิต รวมการ์ดที่ปิด/เก็บ (archived) → รองรับการย้าย "ทั้งหมดรวมประวัติ"
// - actions ทุกบอร์ด จะถูกรวมด้วย card id ในขั้น import เพื่อสร้าง timeline เดียว

import * as fs from 'fs';
import * as path from 'path';
import { BOARD_TO_STAGE, PRODUCTION_BOARD_IDS } from './mapping';

const API = 'https://api.trello.com/1';

// ---- credentials: env ก่อน แล้วค่อยอ่าน .env (ไม่เขียนกลับลงดิสก์) ----
function loadCreds(): { key: string; token: string } {
  const fromEnv = { key: process.env.TRELLO_KEY ?? '', token: process.env.TRELLO_TOKEN ?? '' };
  if (fromEnv.key && fromEnv.token) return fromEnv;
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const [k, ...rest] = s.split('=');
      const v = rest.join('=').trim();
      if (k.trim() === 'TRELLO_KEY' && !fromEnv.key) fromEnv.key = v;
      if (k.trim() === 'TRELLO_TOKEN' && !fromEnv.token) fromEnv.token = v;
    }
  }
  if (!fromEnv.key || !fromEnv.token) {
    throw new Error('ไม่พบ TRELLO_KEY / TRELLO_TOKEN (ตั้งใน env หรือ .env ของ teak-furniture-api)');
  }
  return fromEnv;
}

const creds = loadCreds();

async function trelloGet(pathname: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ key: creds.key, token: creds.token, ...params });
  const url = `${API}/${pathname}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Trello GET ${pathname} → ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawCard {
  id: string;
  boardId: string;
  boardName: string;
  stage: string;
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

async function fetchCards(boardId: string, boardName: string, stage: string): Promise<RawCard[]> {
  const lists: any[] = await trelloGet(`boards/${boardId}/lists`, { filter: 'all', fields: 'id,name,closed' });
  const listName = new Map<string, string>(lists.map((l) => [l.id, l.name]));
  const cards: any[] = await trelloGet(`boards/${boardId}/cards`, {
    filter: 'all',
    fields: 'id,idShort,name,desc,due,dueComplete,closed,idList,idBoard,labels,dateLastActivity',
    members: 'true',
    member_fields: 'fullName,username',
    attachments: 'true',
    attachment_fields: 'id,url,name,mimeType',
  });
  return cards.map((c) => ({
    id: c.id,
    boardId,
    boardName,
    stage,
    idList: c.idList,
    listName: listName.get(c.idList) ?? null,
    name: c.name ?? '',
    desc: c.desc || null,
    due: c.due ?? null,
    dueComplete: !!c.dueComplete,
    closed: !!c.closed,
    dateLastActivity: c.dateLastActivity ?? null,
    labels: (c.labels ?? []).map((l: any) => ({ name: l.name ?? '', color: l.color ?? null })),
    members: (c.members ?? []).map((m: any) => ({ fullName: m.fullName ?? null, username: m.username ?? null })),
    attachments: (c.attachments ?? []).map((a: any) => ({
      id: a.id,
      url: a.url,
      name: a.name ?? null,
      mimeType: a.mimeType ?? null,
    })),
  }));
}

async function fetchActions(boardId: string): Promise<RawAction[]> {
  const out: RawAction[] = [];
  const seen = new Set<string>();
  let before: string | undefined;
  const filter = 'createCard,copyCard,moveCardToBoard,moveCardFromBoard,updateCard,commentCard';
  for (let page = 0; page < 200; page++) {
    const params: Record<string, string> = {
      filter,
      limit: '1000',
      memberCreator: 'true',
      memberCreator_fields: 'fullName,username',
    };
    if (before) params.before = before;
    const actions: any[] = await trelloGet(`boards/${boardId}/actions`, params);
    if (!actions.length) break;
    let oldest = actions[0].date as string;
    let added = 0;
    for (const a of actions) {
      if (a.date < oldest) oldest = a.date;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      added++;
      const d = a.data ?? {};
      out.push({
        id: a.id,
        type: a.type,
        date: a.date,
        cardId: d.card?.id ?? null,
        memberCreator: a.memberCreator?.fullName ?? a.memberCreator?.username ?? null,
        listBefore: d.listBefore?.name ?? null,
        listAfter: d.listAfter?.name ?? null,
        boardSource: d.boardSource?.name ?? null,
        boardTarget: d.board?.name ?? d.boardTarget?.name ?? null,
        text: d.text ?? null,
      });
    }
    if (actions.length < 1000 || added === 0) break;
    before = oldest;
    await sleep(200);
  }
  return out;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, 15) + 'Z';
  const destDir = path.join(process.cwd(), 'data', 'trello', stamp);
  fs.mkdirSync(destDir, { recursive: true });

  const allCards: RawCard[] = [];
  const allActions: RawAction[] = [];
  const perBoard: { board: string; stage: string; cards: number; actions: number }[] = [];

  for (const boardId of PRODUCTION_BOARD_IDS) {
    const { name, stage } = BOARD_TO_STAGE[boardId];
    process.stdout.write(`• ${name} (${stage}) … `);
    const cards = await fetchCards(boardId, name, stage);
    const actions = await fetchActions(boardId);
    allCards.push(...cards);
    allActions.push(...actions);
    perBoard.push({ board: name, stage, cards: cards.length, actions: actions.length });
    // eslint-disable-next-line no-console
    console.log(`${cards.length} cards, ${actions.length} actions`);
  }

  // ดีดัพ action ข้ามบอร์ด (การย้ายบอร์ดอาจปรากฏในหลายบอร์ด)
  const uniqActions = Array.from(new Map(allActions.map((a) => [a.id, a])).values());

  fs.writeFileSync(path.join(destDir, 'cards.json'), JSON.stringify(allCards, null, 2), 'utf8');
  fs.writeFileSync(path.join(destDir, 'actions.json'), JSON.stringify(uniqActions, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(destDir, 'manifest.json'),
    JSON.stringify(
      {
        source: 'Trello REST API (/boards/{id}/cards + /actions)',
        retrievedAt: new Date().toISOString(),
        boards: perBoard,
        totalCards: allCards.length,
        totalActions: uniqActions.length,
      },
      null,
      2,
    ),
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(`\n✓ snapshot → ${destDir}\n  cards: ${allCards.length} · actions: ${uniqActions.length}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fetch-trello failed:', e.message ?? e);
  process.exit(1);
});
