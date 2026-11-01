import { discountPercent, formatMoney } from '../lib/format'

export default function PriceTag({
  price,
  compareAt,
  currency = 'COP',
  large = false,
}: {
  price: number
  compareAt?: number | null
  currency?: string
  large?: boolean
}) {
  const off = discountPercent(price, compareAt)
  const onSale = Boolean(compareAt && compareAt > price)

  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className={`${large ? 'text-[28px] sm:text-[32px]' : 'text-[15px]'} font-medium text-ink tabular-nums leading-none`}>
        {formatMoney(price, currency)}
      </span>
      {onSale && (
        <span className={`${large ? 'text-base' : 'text-[13px]'} text-muted line-through tabular-nums`}>
          {formatMoney(compareAt!, currency)}
        </span>
      )}
      {off && (
        <span className={`${large ? 'text-xs' : 'text-[10px]'} font-semibold uppercase tracking-[0.12em] text-accent`}>
          −{off}%
        </span>
      )}
    </div>
  )
}
