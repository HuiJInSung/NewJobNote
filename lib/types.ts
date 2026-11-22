export type Level = 1 | 2 | 3;

export type TreeNode = {
  id: string;
  parentId: string | null;
  level: Level;
  name: string;
  order: number;
  hasNote: boolean;
  updatedAt: string;
};

export type NodeDetail = TreeNode & {
  content: string;
  createdAt: string;
};

export const LEVEL_LABEL: Record<Level, string> = { 1: "大類", 2: "中類", 3: "小分類" };

const DIGITS = "零一二三四五六七八九";
/** 1 → 一, 10 → 十, 12 → 十二, 25 → 二十五 */
export function cjkNumber(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? "" : DIGITS[tens]}十${ones ? DIGITS[ones] : ""}`;
}
