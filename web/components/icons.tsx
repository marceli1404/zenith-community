import type { ComponentType, CSSProperties } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CaretDown,
  Check,
  Clock,
  EnvelopeSimple,
  Eye,
  FileText,
  Globe,
  Key,
  List,
  LockSimple,
  MagnifyingGlass,
  Minus,
  Moon,
  Play,
  Plus,
  Pulse,
  Quotes,
  ShieldCheck,
  Sparkle,
  Star,
  Sun,
  X,
  type IconProps as PhosphorProps,
} from "@phosphor-icons/react";

/**
 * Public-site icons. Phosphor, regular weight (a 1.5px line at 24px) so every
 * glyph shares one stroke. Wrapped to keep the site's stable names and the
 * `lx-icon` hook, and to make icons decorative unless a `title` is given.
 */
export interface IconProps {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  filled?: boolean;
}

function icon(name: string, Glyph: ComponentType<PhosphorProps>) {
  const Icon = ({ size = 20, title, className, style, filled }: IconProps) => (
    <Glyph
      size={size}
      weight={filled ? "fill" : "regular"}
      className={className ? `lx-icon ${className}` : "lx-icon"}
      style={style}
      alt={title}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    />
  );
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconMenu = icon("Menu", List);
export const IconClose = icon("Close", X);
export const IconArrowRight = icon("ArrowRight", ArrowRight);
export const IconArrowUpRight = icon("ArrowUpRight", ArrowUpRight);
export const IconCheck = icon("Check", Check);
export const IconPlus = icon("Plus", Plus);
export const IconMinus = icon("Minus", Minus);
export const IconChevronDown = icon("ChevronDown", CaretDown);
export const IconSearch = icon("Search", MagnifyingGlass);
export const IconShield = icon("Shield", ShieldCheck);
export const IconLock = icon("Lock", LockSimple);
export const IconSun = icon("Sun", Sun);
export const IconMoon = icon("Moon", Moon);
export const IconEye = icon("Eye", Eye);
export const IconPulse = icon("Pulse", Pulse);
export const IconDocument = icon("Document", FileText);
export const IconClock = icon("Clock", Clock);
export const IconMail = icon("Mail", EnvelopeSimple);
export const IconKey = icon("Key", Key);
export const IconGlobe = icon("Globe", Globe);
export const IconQuote = icon("Quote", Quotes);
export const IconStar = icon("Star", Star);
export const IconPlay = icon("Play", Play);
export const IconSparkle = icon("Sparkle", Sparkle);
