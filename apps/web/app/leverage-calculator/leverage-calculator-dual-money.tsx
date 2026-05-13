'use client';

import { formatRubAmount, rubFromUsd, formatRubSigned } from './leverage-calculator-fx.util';
import { formatUsd, formatUsdSigned } from './leverage-calculator-page.util';

export function DualUsdRub({
  usd,
  rubPerUsd,
  usdDigits = 2,
}: {
  usd: number | null | undefined;
  rubPerUsd: number | null;
  usdDigits?: number;
}) {
  const rub = rubFromUsd(usd, rubPerUsd);
  return (
    <span className="leverageDualMoney">
      {formatUsd(usd, usdDigits)}
      {rub != null ? (
        <>
          {' '}
          <span className="leverageMuted">(~ {formatRubAmount(rub)})</span>
        </>
      ) : null}
    </span>
  );
}

export function DualUsdRubSigned({
  usd,
  rubPerUsd,
  usdDigits = 2,
}: {
  usd: number | null | undefined;
  rubPerUsd: number | null;
  usdDigits?: number;
}) {
  const rub = rubFromUsd(usd, rubPerUsd);
  return (
    <span className="leverageDualMoney">
      {formatUsdSigned(usd, usdDigits)}
      {rub != null ? (
        <>
          {' '}
          <span className="leverageMuted">(~ {formatRubSigned(rub)})</span>
        </>
      ) : null}
    </span>
  );
}
