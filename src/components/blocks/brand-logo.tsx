// Логотип-вордмарк SALES DAILY (горизонтальный /sd-logo-long.svg и вертикальный
// /sd-logo-vertical.svg). Файлы одноцветные (#FDF0D5), поэтому отрисовываем их
// как CSS-маску, а цвет берём из currentColor — так знак адаптируется под тему:
// тёмный на светлом фоне, кремовый на тёмном. Цвет задаётся text-* классом,
// размер — h-*/w-* в className (нужны оба, у маски нет собственных размеров).
export function BrandLogo({
  src,
  label = "SALES DAILY",
  className = "",
}: {
  src: string
  label?: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-block bg-current ${className}`}
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  )
}
