// ตารางแมปทั้งหมดสำหรับการนำเข้า Trello → Teak DB
// ทุกอย่างที่ importer ต้องรู้แต่ "ไม่ได้อยู่ใน payload ของการ์ด" อยู่ในไฟล์นี้ที่เดียว
// เพื่อให้คนแก้/เติม (label ใหม่, พนักงานใหม่) แล้วรัน import ซ้ำได้อย่างปลอดภัย

/** บอร์ดการผลิตของ workspace "EMPTY CHAIR" — 1 บอร์ด = 1 ขั้นตอน (stage) */
export const BOARD_TO_STAGE: Record<string, { name: string; stage: StageCode }> = {
  '65ee7cae0c6f9e376e36364b': { name: 'ขึ้นแบบ', stage: 'DESIGN' },
  '638382c77528700aff09c53c': { name: 'รอของ', stage: 'WAITING' },
  '638383e2da479c0503dfb732': { name: 'เก็บงาน', stage: 'ASSEMBLY' },
  '6383841244505e18581ed9d5': { name: 'ทำสี', stage: 'PAINT' },
  '63838483e0fe3926074d82dd': { name: 'ส่ง', stage: 'SHIP' },
  '6947dc4dc92b52d0638fae97': { name: 'ส่งแล้ว', stage: 'SHIPPED' },
};

export type StageCode = 'DESIGN' | 'WAITING' | 'ASSEMBLY' | 'PAINT' | 'SHIP' | 'SHIPPED';

/** id ของบอร์ดที่จะดึง — บอร์ดที่ไม่ใช่การผลิต (สต๊อก/คอนเทนต์/ใบเสร็จ) จงใจไม่รวม */
export const PRODUCTION_BOARD_IDS = Object.keys(BOARD_TO_STAGE);

/** แมปชื่อบอร์ด/stage (ไทย) → stage code — ใช้ตอนรู้แค่ชื่อ เช่นจาก action ย้ายบอร์ด */
export const STAGE_BY_BOARD_NAME: Record<string, StageCode> = {
  ขึ้นแบบ: 'DESIGN',
  รอของ: 'WAITING',
  เก็บงาน: 'ASSEMBLY',
  ทำสี: 'PAINT',
  ส่ง: 'SHIP',
  ส่งแล้ว: 'SHIPPED',
  ส่งสำเร็จ: 'SHIPPED',
};

// ---------------------------------------------------------------------------
// Label → มิติข้อมูล
// ---------------------------------------------------------------------------
export type LabelDim =
  | { kind: 'color'; value: string }
  | { kind: 'region'; value: string }
  | { kind: 'frameSource'; value: 'IN_HOUSE' | 'OUTSOURCED' }
  | { kind: 'custom'; value: string };

const FRAME_SOURCE_LABELS: Record<string, 'IN_HOUSE' | 'OUTSOURCED'> = {
  ผลิตเอง: 'IN_HOUSE',
  ทำเอง: 'IN_HOUSE',
  ซื้อโครง: 'OUTSOURCED',
  จ้างผลิต: 'OUTSOURCED',
  จ้างทำ: 'OUTSOURCED',
  outsource: 'OUTSOURCED',
  outsourced: 'OUTSOURCED',
};

const REGION_LABELS: Record<string, string> = {
  ภาคเหนือ: 'เหนือ',
  ภาคกลาง: 'กลาง',
  ภาคอีสาน: 'อีสาน',
  ภาคตะวันออกเฉียงเหนือ: 'อีสาน',
  ภาคใต้: 'ใต้',
  ภาคตะวันออก: 'ตะวันออก',
  ภาคตะวันตก: 'ตะวันตก',
  เหนือ: 'เหนือ',
  กลาง: 'กลาง',
  อีสาน: 'อีสาน',
  ใต้: 'ใต้',
};

// สีมีเปิดกว้าง — ลิสต์ที่รู้จักไว้ ส่วนที่ไม่รู้จักจะถูกเก็บเป็น custom tag (ขึ้นรายงานให้คนมาเติม)
// เพื่อไม่ให้เดาผิดว่าเป็น "สี" ทั้งที่อาจเป็นออปชั่นอื่น
const COLOR_LABELS = new Set<string>([
  'Natural',
  'Walnut',
  'Hazel',
  'Black',
  'White',
  'Oak',
  'Golden Oak',
  'Teak',
  'Espresso',
  'Coffee',
  'Dark Brown',
  'Light Brown',
  'Brown',
  'Cherry',
  'Mahogany',
  'Ebony',
  'Grey',
  'Gray',
  'Honey',
  'Maple',
]);

/** จัดหมวดของ label ตามชื่อ (case-insensitive สำหรับชุดสี) */
export function classifyLabel(nameRaw: string): LabelDim {
  const name = (nameRaw ?? '').trim();
  if (!name) return { kind: 'custom', value: name };
  if (FRAME_SOURCE_LABELS[name]) return { kind: 'frameSource', value: FRAME_SOURCE_LABELS[name] };
  if (REGION_LABELS[name]) return { kind: 'region', value: REGION_LABELS[name] };
  const colorHit = [...COLOR_LABELS].find((c) => c.toLowerCase() === name.toLowerCase());
  if (colorHit) return { kind: 'color', value: colorHit };
  return { kind: 'custom', value: name };
}

// ---------------------------------------------------------------------------
// คน: Trello member fullName / username → เบอร์ user ที่ seed ไว้ (identity การ login ใน Teak)
// เติม dict นี้เมื่อรู้ว่าใครเป็นใคร แล้วรัน import ซ้ำเพื่อ backfill actor ที่เคยว่างได้
// ชื่อที่พบในบอร์ดปัจจุบันถูกลิสต์เป็น TODO ไว้ให้ (คอมเมนต์ = ยังไม่แมป → รายงานจะเตือน)
// ---------------------------------------------------------------------------
export const TRELLO_MEMBER_TO_USER_PHONE: Record<string, string> = {
  // 'Suphawat Khomarwut': '0810000001',
  // 'Nitiphong C': '0810000000',
  // 'Ronayut Tangon': '08100000xx',
  // 'Natcha Yookhlai': '08100000xx',
  // 'แพรพรรณ จริยมุขยากร': '08100000xx',
  // 'พราวปภัทร์ แป้นนะ': '08100000xx',
  // 'Mr. H 2 O': '08100000xx',
  // 'ขาย เปส': '08100000xx',
};

/** priority จากชื่อ list (เช่น "🔥ด่วนจัด") */
export function priorityFromListName(listName?: string | null): 'URGENT' | 'NORMAL' {
  if (!listName) return 'NORMAL';
  return /ด่วน|เร่ง|🔥|urgent/i.test(listName) ? 'URGENT' : 'NORMAL';
}
