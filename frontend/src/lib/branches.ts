import {
  Code2,
  Cpu,
  CircuitBoard,
  Zap,
  Cog,
  Building2,
  Layers,
} from "lucide-react";
import type { Entity } from "./types";
const identities = {
  CSE: {
    color: "var(--branch-cse)",
    Icon: Code2,
    label: "Build the next thing.",
  },
  ECE: {
    color: "var(--branch-ece)",
    Icon: Cpu,
    label: "Stay on your wavelength.",
  },
  IT: {
    color: "var(--branch-it)",
    Icon: CircuitBoard,
    label: "Make the connections.",
  },
  EE: { color: "var(--branch-ee)", Icon: Zap, label: "Power your next idea." },
  ME: { color: "var(--branch-me)", Icon: Cog, label: "Put ideas in motion." },
  CE: {
    color: "var(--branch-ce)",
    Icon: Building2,
    label: "Build on solid ground.",
  },
};
export function branchIdentity(code?: string) {
  return (
    identities[code?.toUpperCase() as keyof typeof identities] || {
      color: "var(--primary)",
      Icon: Layers,
      label: "Your place in the archive.",
    }
  );
}
export function branchPath(branch: Entity, programs: Entity[]) {
  const program = programs.find((p) => p._id === branch.program);
  return program
    ? `/programs/${program.slug}/${branch.slug}`
    : `/papers?branch=${encodeURIComponent(branch._id)}`;
}
