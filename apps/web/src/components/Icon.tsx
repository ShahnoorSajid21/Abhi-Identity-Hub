import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Construction,
  DatabaseZap,
  FileCheck,
  FileQuestion,
  FileWarning,
  GitCommitHorizontal,
  Inbox,
  ListFilter,
  Lock,
  PlugZap,
  ScrollText,
  Search,
  SearchX,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserSearch,
  Users,
  WifiOff,
} from 'lucide-react';

/**
 * Icon registry.
 *
 * An explicit map rather than a namespace import, because `import * as icons`
 * pulls the entire icon set into the bundle. Every name used by strings.ts
 * appears here; if a new empty state names an icon that is missing, it falls
 * back rather than crashing the screen it was meant to explain.
 */
const REGISTRY = {
  Activity,
  AlertCircle,
  CheckCircle2,
  Construction,
  DatabaseZap,
  FileCheck,
  FileQuestion,
  FileWarning,
  GitCommitHorizontal,
  Inbox,
  ListFilter,
  Lock,
  PlugZap,
  ScrollText,
  Search,
  SearchX,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserSearch,
  Users,
  WifiOff,
} as const;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = REGISTRY[name as keyof typeof REGISTRY] ?? AlertCircle;
  return <Component size={size} className={className} aria-hidden="true" />;
}
