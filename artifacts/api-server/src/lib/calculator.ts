export interface CalculationResult {
  grossSales: number;
  commissionPct: number;
  commissionAmount: number;
  netGross: number;
  winsAmount: number;
  reservePct: number;
  reserveAmount: number;
  writerBalance: number;
}

export function calculateWriter(
  grossSales: number,
  winsAmount: number,
  commissionPct: number,
  reservePct: number,
): CalculationResult {
  const commissionAmount = grossSales * commissionPct;
  const netGross = grossSales - commissionAmount;
  const reserveAmount = netGross * reservePct;
  const writerBalance = netGross - winsAmount - reserveAmount;
  return {
    grossSales,
    commissionPct,
    commissionAmount,
    netGross,
    winsAmount,
    reservePct,
    reserveAmount,
    writerBalance,
  };
}
