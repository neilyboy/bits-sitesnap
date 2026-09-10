import React from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

// Camera — lens + body
const IconCameraCat = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

// Access Control — keycard / door with card
const IconAccessControl = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="2" y="6" width="13" height="12" rx="1" />
    <path d="M15 9h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6" />
    <circle cx="7" cy="12" r="1.5" />
  </svg>
);

// Intercom — speaker panel
const IconIntercom = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <circle cx="12" cy="8" r="2" />
    <line x1="8" y1="14" x2="16" y2="14" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

// Air Quality — wind / airflow
const IconAirQuality = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M9.59 4.59A2 2 0 1 1 11 8H2" />
    <path d="M17.73 4.27A2.5 2.5 0 1 1 19.5 8.5H2" />
    <path d="M14.59 19.41A2 2 0 1 0 16 16H2" />
  </svg>
);

// Alarms — bell
const IconAlarms = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

// Workplace — desk / monitor
const IconWorkplace = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// Data Closet — server rack
const IconDataCloset = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="4" y="2" width="16" height="20" rx="1" />
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="7" cy="4.5" r="0.5" fill="currentColor" />
    <circle cx="7" cy="9.5" r="0.5" fill="currentColor" />
    <circle cx="7" cy="14.5" r="0.5" fill="currentColor" />
    <circle cx="7" cy="19.5" r="0.5" fill="currentColor" />
  </svg>
);

// Other — dots / more
const IconOther = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const ICON_MAP: Record<string, React.FC<IconProps>> = {
  "Cameras": IconCameraCat,
  "Access Control": IconAccessControl,
  "Intercom": IconIntercom,
  "Air Quality": IconAirQuality,
  "Alarms": IconAlarms,
  "Workplace": IconWorkplace,
  "Data Closet": IconDataCloset,
  "Other": IconOther,
};

export function CategoryIcon({ name, size = 16, className, style }: IconProps & { name: string }) {
  const Icon = ICON_MAP[name] ?? IconOther;
  return <Icon size={size} className={className} style={style} />;
}
