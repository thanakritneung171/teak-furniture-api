// Parser ชื่อการ์ด Trello แบบ best-effort — ชื่อการ์ดยัดหลายอย่างรวมกันเป็นข้อความอิสระ
// หลักการ: "เก็บ raw ไว้เสมอ + ไม่มั่นใจให้เป็น null ดีกว่าเดา" (ห้ามแต่งจำนวนเอง)
// ตัวอย่าง: "Guno/ ศุภสิน🔴1/1 ตู้ 100*50สูง55 จำนวน 2 ตัว สีเฮเซล (ไลน์) หลักสี่ กทม. 99H"

export interface ParsedTitle {
  raw: string;
  customer: string | null;
  quantity: number | null; // null = อ่านจำนวนชัดเจนไม่ได้ (ห้ามเดา)
  productType: string | null;
  dimensions: string | null;
  channel: string | null;
  code: string | null;
  colorHint: string | null;
  flags: string[]; // เช่น no-quantity, no-customer, no-product-type
}

/** ประเภทเฟอร์นิเจอร์ที่รู้จัก (เรียงยาว→สั้น เพื่อจับคำเฉพาะก่อน) */
const PRODUCT_TYPES = [
  'ตู้เสื้อผ้า',
  'ตู้ข้าง',
  'ตู้โชว์',
  'ชั้นวาง',
  'ชั้นหนังสือ',
  'โต๊ะกลาง',
  'โต๊ะทำงาน',
  'โต๊ะอาหาร',
  'เก้าอี้',
  'ม้านั่ง',
  'เตียง',
  'โซฟา',
  'เคาน์เตอร์',
  'พาร์ทิชัน',
  'โต๊ะ',
  'ตู้',
  'ชั้น',
  'เบาะ',
];

const CHANNELS: Record<string, string> = {
  ไลน์: 'Line',
  line: 'Line',
  เฟส: 'Facebook',
  เฟซ: 'Facebook',
  facebook: 'Facebook',
  fb: 'Facebook',
  เพจ: 'Facebook',
  page: 'Facebook',
  ig: 'Instagram',
  instagram: 'Instagram',
  ไอจี: 'Instagram',
  shopee: 'Shopee',
  ช้อปปี้: 'Shopee',
  lazada: 'Lazada',
  ลาซาด้า: 'Lazada',
  tiktok: 'TikTok',
  ติ๊กต็อก: 'TikTok',
  หน้าร้าน: 'Walk-in',
  walkin: 'Walk-in',
  โทร: 'Phone',
};

const CIRCLE_EMOJI = /[🔴🟠🟡🟢🔵🟣🟤⚪⚫🔺🔻▪️◾]/u;

export function parseTitle(rawInput: string): ParsedTitle {
  const raw = (rawInput ?? '').trim();
  const flags: string[] = [];

  // ---- customer: ส่วนหน้าสุดก่อนถึง emoji วงกลม / อัตราส่วน N/N / ตัวเลขก้อนแรก ----
  let customer: string | null = null;
  {
    let cut = raw.length;
    const emoji = raw.match(CIRCLE_EMOJI);
    if (emoji && emoji.index !== undefined) cut = Math.min(cut, emoji.index);
    const ratio = raw.match(/\d+\s*\/\s*\d+/);
    if (ratio && ratio.index !== undefined) cut = Math.min(cut, ratio.index);
    // ตัดที่ตัวเลขก้อนแรกที่ตามด้วยหน่วย/มิติ ถ้ายังไม่เจอตัวตัด
    const head = raw.slice(0, cut).replace(/[/|:\-–]+\s*$/, '').trim();
    if (head && head.length >= 2) customer = head;
  }
  if (!customer) flags.push('no-customer');

  // ---- quantity: "จำนวน N" ก่อน แล้วค่อย "N ตัว/ชิ้น/ใบ/ชุด" ----
  let quantity: number | null = null;
  {
    const m1 = raw.match(/จำนวน\s*(\d+)/);
    const m2 = raw.match(/(\d+)\s*(?:ตัว|ชิ้น|ใบ|ชุด|อัน)/);
    const n = m1 ? Number(m1[1]) : m2 ? Number(m2[1]) : NaN;
    if (Number.isFinite(n) && n > 0) quantity = n;
  }
  if (quantity === null) flags.push('no-quantity');

  // ---- productType ----
  let productType: string | null = null;
  for (const t of PRODUCT_TYPES) {
    if (raw.includes(t)) {
      productType = t;
      break;
    }
  }
  if (!productType) flags.push('no-product-type');

  // ---- dimensions: 100*50สูง55 / 115x45x45 / 120*60 ซม. ----
  let dimensions: string | null = null;
  {
    const m = raw.match(
      /\d+(?:\.\d+)?\s*(?:[*xX×]|สูง|ยาว|กว้าง|ลึก)\s*\d+(?:\.\d+)?(?:\s*(?:[*xX×]|สูง|ยาว|กว้าง|ลึก)\s*\d+(?:\.\d+)?)*(?:\s*(?:ซม\.?|cm|มม\.?|mm|นิ้ว|"))?/,
    );
    if (m) dimensions = m[0].trim();
  }

  // ---- channel: ในวงเล็บก่อน แล้วค่อยหาแบบคำโดด ----
  let channel: string | null = null;
  {
    const paren = raw.match(/\(([^)]+)\)/g) ?? [];
    for (const p of paren) {
      const key = p.replace(/[()]/g, '').trim().toLowerCase();
      if (CHANNELS[key]) {
        channel = CHANNELS[key];
        break;
      }
    }
    if (!channel) {
      for (const [k, v] of Object.entries(CHANNELS)) {
        if (new RegExp(`(^|[\\s(])${k}([\\s)]|$)`, 'i').test(raw)) {
          channel = v;
          break;
        }
      }
    }
  }

  // ---- code: token ท้ายที่มีทั้งตัวอักษร+ตัวเลข เช่น 99H, CB048 ----
  let code: string | null = null;
  {
    const tokens = raw.split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tok = tokens[i].replace(/[()]/g, '');
      if (/^[A-Za-z]{0,3}\d{1,4}[A-Za-z]{0,2}$/.test(tok) && /\d/.test(tok) && /[A-Za-z]/.test(tok)) {
        code = tok.toUpperCase();
        break;
      }
    }
  }

  // ---- colorHint: "สีXXX" (label เชื่อถือได้กว่า ใช้เป็น fallback เท่านั้น) ----
  let colorHint: string | null = null;
  {
    const m = raw.match(/สี\s*([^\s()]+)/);
    if (m) colorHint = m[1].trim();
  }

  return { raw, customer, quantity, productType, dimensions, channel, code, colorHint, flags };
}

// ---- self-test เล็ก ๆ: รัน `ts-node prisma/import/parse-title.ts` เพื่อดูผลแยกส่วน ----
if (require.main === module) {
  const samples = [
    'Guno/ ศุภสิน🔴1/1 ตู้ 100*50สูง55 จำนวน 2 ตัว สีเฮเซล (ไลน์) หลักสี่ กทม. 99H',
    'Tera Nantatero /ธีระ 1/1 ตู้ 115*45สูง45 จำนวน 1 ตัว ทำสี natural เบาะหนา 2 นิ้ว (เฟส) CB048 บางพลี',
    'testt1',
  ];
  for (const s of samples) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(parseTitle(s), null, 2));
  }
}
