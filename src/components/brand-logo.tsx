import * as React from "react";

interface BrandLogoProps {
  size?: number;
  className?: string;
}

/**
 * Asiyst Plan stacked-tiers emblem (`asiyst_plan_logo_square_v6.svg`):
 * Three stacked layers on an ivory square (#F5F4EF):
 * - Top black diamond (#000000) with volt-lime 4-point spark (#ACEC0F)
 * - Middle black chevron (#000000)
 * - Bottom volt-lime chevron (#ACEC0F)
 */
export function AsiystPlanLogoMark({ size = 34, className = "" }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 680 680"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="10"
        y="10"
        width="660"
        height="660"
        rx="136"
        fill="#F5F4EF"
        stroke="#E4E2D8"
        strokeWidth="20"
      />
      <polyline
        points="190,396 340,472 490,396"
        fill="none"
        stroke="#ACEC0F"
        strokeWidth="38"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="190,328 340,404 490,328"
        fill="none"
        stroke="#000000"
        strokeWidth="38"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points="340,190 478,262 340,334 202,262"
        fill="#000000"
        stroke="#000000"
        strokeWidth="28"
        strokeLinejoin="round"
      />
      <path
        d="M340 224 L351 251 L378 262 L351 273 L340 300 L329 273 L302 262 L329 251 Z"
        fill="#ACEC0F"
      />
    </svg>
  );
}
