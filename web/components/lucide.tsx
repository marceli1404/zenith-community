import type { ComponentType, CSSProperties } from "react";
import {
  ArrowLeft as PhArrowLeft,
  Bell as PhBell,
  DesktopTower,
  DeviceMobile,
  Key,
  Laptop as PhLaptop,
  LockKey,
  Moon as PhMoon,
  Sun as PhSun,
  UserCircle,
  ArrowRight as PhArrowRight,
  ArrowSquareOut,
  ArrowUpRight as PhArrowUpRight,
  ArrowsClockwise,
  BookOpen as PhBookOpen,
  CaretRight,
  CaretDown,
  CalendarBlank,
  Lifebuoy,
  Check as PhCheck,
  CheckCircle,
  CircleNotch,
  Copy as PhCopy,
  CreditCard as PhCreditCard,
  DownloadSimple,
  EnvelopeSimpleOpen,
  FileCode,
  FileText as PhFileText,
  GearSix,
  Globe as PhGlobe,
  Info as PhInfo,
  List,
  LockSimple,
  MagnifyingGlass,
  Plus as PhPlus,
  Pulse,
  Receipt,
  Scan,
  ShieldCheck as PhShieldCheck,
  ShieldWarning,
  SignOut,
  Sparkle,
  SquaresFour,
  Star as PhStar,
  Trash,
  Users as PhUsers,
  Warning,
  WarningCircle,
  X as PhX,
  type IconProps as PhosphorProps,
} from "@phosphor-icons/react";

/**
 * Console icon set. The console was written against lucide-react; this module
 * keeps those names and props but draws Phosphor glyphs, so the whole product
 * shares one icon family (regular weight, 1.5px line at 24px).
 */
export interface LucideProps {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number | string;
  fill?: string;
  color?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}
export type LucideIcon = ComponentType<LucideProps>;

function wrap(name: string, Glyph: ComponentType<PhosphorProps>): LucideIcon {
  const Icon = ({ size = 24, className, style, fill, color, strokeWidth: _strokeWidth, ...aria }: LucideProps) => (
    <Glyph
      size={size}
      weight={fill && fill !== "none" ? "fill" : "regular"}
      className={className}
      style={style}
      color={color}
      aria-hidden={aria["aria-label"] ? undefined : (aria["aria-hidden"] ?? true)}
      aria-label={aria["aria-label"]}
      role={aria["aria-label"] ? "img" : undefined}
    />
  );
  Icon.displayName = name;
  return Icon;
}

export const Activity = wrap("Activity", Pulse);
export const AlertTriangle = wrap("AlertTriangle", Warning);
export const Bell = wrap("Bell", PhBell);
export const BookOpen = wrap("BookOpen", PhBookOpen);
export const KeyRound = wrap("KeyRound", Key);
export const Laptop = wrap("Laptop", PhLaptop);
export const LockKeyhole = wrap("LockKeyhole", LockKey);
export const Monitor = wrap("Monitor", DesktopTower);
export const Moon = wrap("Moon", PhMoon);
export const Smartphone = wrap("Smartphone", DeviceMobile);
export const Sun = wrap("Sun", PhSun);
export const UserRound = wrap("UserRound", UserCircle);
export const ArrowLeft = wrap("ArrowLeft", PhArrowLeft);
export const ArrowRight = wrap("ArrowRight", PhArrowRight);
export const ArrowUpRight = wrap("ArrowUpRight", PhArrowUpRight);
export const Check = wrap("Check", PhCheck);
export const CheckCircle2 = wrap("CheckCircle2", CheckCircle);
export const ChevronRight = wrap("ChevronRight", CaretRight);
export const ChevronDown = wrap("ChevronDown", CaretDown);
export const Calendar = wrap("Calendar", CalendarBlank);
export const LifeBuoy = wrap("LifeBuoy", Lifebuoy);
export const CircleAlert = wrap("CircleAlert", WarningCircle);
export const Copy = wrap("Copy", PhCopy);
export const CreditCard = wrap("CreditCard", PhCreditCard);
export const Download = wrap("Download", DownloadSimple);
export const ExternalLink = wrap("ExternalLink", ArrowSquareOut);
export const FileJson = wrap("FileJson", FileCode);
export const FileText = wrap("FileText", PhFileText);
export const Globe = wrap("Globe", PhGlobe);
export const Info = wrap("Info", PhInfo);
export const LayoutDashboard = wrap("LayoutDashboard", SquaresFour);
export const LoaderCircle = wrap("LoaderCircle", CircleNotch);
export const Lock = wrap("Lock", LockSimple);
export const LogOut = wrap("LogOut", SignOut);
export const MailCheck = wrap("MailCheck", EnvelopeSimpleOpen);
export const Menu = wrap("Menu", List);
export const Plus = wrap("Plus", PhPlus);
export const ReceiptText = wrap("ReceiptText", Receipt);
export const RefreshCw = wrap("RefreshCw", ArrowsClockwise);
export const ScanLine = wrap("ScanLine", Scan);
export const Search = wrap("Search", MagnifyingGlass);
export const Settings = wrap("Settings", GearSix);
export const ShieldAlert = wrap("ShieldAlert", ShieldWarning);
export const ShieldCheck = wrap("ShieldCheck", PhShieldCheck);
export const Sparkles = wrap("Sparkles", Sparkle);
export const Star = wrap("Star", PhStar);
export const Trash2 = wrap("Trash2", Trash);
export const Users = wrap("Users", PhUsers);
export const X = wrap("X", PhX);
