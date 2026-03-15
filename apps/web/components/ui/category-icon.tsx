'use client';

import {
  Briefcase,
  Building2,
  Car,
  Cpu,
  FileText,
  HardHat,
  Home,
  type LucideIcon,
  Settings,
  Wrench,
  Zap,
  Lightbulb,
  Ruler,
  Box,
  Palette,
  Factory,
  Leaf,
  Heart,
  GraduationCap,
  Scale,
} from 'lucide-react';

/** Allowed category icon names (stored in DB). Add new icons here and to the map below. */
export const CATEGORY_ICON_NAMES = [
  'Wrench',
  'FileText',
  'Building2',
  'Car',
  'Home',
  'Cpu',
  'Zap',
  'Settings',
  'Briefcase',
  'HardHat',
  'Lightbulb',
  'Ruler',
  'Box',
  'Palette',
  'Factory',
  'Leaf',
  'Heart',
  'GraduationCap',
  'Scale',
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

const ICON_MAP: Record<CategoryIconName, LucideIcon> = {
  Wrench,
  FileText,
  Building2,
  Car,
  Home,
  Cpu,
  Zap,
  Settings,
  Briefcase,
  HardHat,
  Lightbulb,
  Ruler,
  Box,
  Palette,
  Factory,
  Leaf,
  Heart,
  GraduationCap,
  Scale,
};

type Props = {
  /** Icon name from category (e.g. "Wrench"). Renders nothing if invalid or empty. */
  name: string | null | undefined;
  className?: string;
  size?: number;
};

export function CategoryIcon({ name, className, size = 18 }: Props) {
  if (!name || !(name in ICON_MAP)) return null;
  const Icon = ICON_MAP[name as CategoryIconName];
  if (!Icon) return null;
  return <Icon className={className} size={size} aria-hidden />;
}
