import type { LucideIcon } from "./lucide";
import "./motion-icon.css";

export type IconMotion =
  | "alert"
  | "arrow"
  | "bell"
  | "check"
  | "dashboard"
  | "data"
  | "device"
  | "document"
  | "download"
  | "logout"
  | "orbit"
  | "refresh"
  | "scan"
  | "search"
  | "settings"
  | "shield"
  | "theme"
  | "user";

export function MotionIcon({
  icon: Icon,
  motion,
  size = 18,
  active = false,
  className,
}: {
  icon: LucideIcon;
  motion: IconMotion;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`motion-icon${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      data-motion={motion}
      style={{ width: size, height: size }}
    >
      <span className="motion-icon__glyph"><Icon size={size} /></span>
    </span>
  );
}
