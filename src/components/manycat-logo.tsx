import Image from "next/image";

import { cn } from "@/lib/utils";

type ManycatLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
};

/** Monochrome mark: black on light, white on dark. */
export function ManycatLogo({
  alt = "manycat",
  width = 56,
  height = 56,
  className,
  priority,
}: ManycatLogoProps) {
  return (
    <span className={cn("relative inline-grid", className)}>
      <Image
        src="/manycat-logo.png"
        alt={alt}
        width={width}
        height={height}
        className="col-start-1 row-start-1 size-full dark:hidden"
        priority={priority}
      />
      <Image
        src="/manycat-logo-dark.png"
        alt=""
        width={width}
        height={height}
        className="col-start-1 row-start-1 hidden size-full dark:block"
        aria-hidden
        priority={priority}
      />
    </span>
  );
}
