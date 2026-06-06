/**
 * BuildSteps — Shows agent pipeline phases as a visual step indicator.
 */

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { AgentPhase } from "@/ai/agent";

interface Props {
  currentPhase: AgentPhase;
}

const STEPS: { phase: AgentPhase; label: string }[] = [
  { phase: "understanding", label: "Analyseren" },
  { phase: "planning", label: "Plannen" },
  { phase: "building", label: "Bouwen" },
  { phase: "testing", label: "Testen" },
  { phase: "scoring", label: "Scoren" },
  { phase: "reviewing", label: "Reviewen" },
  { phase: "fixing", label: "Verbeteren" },
];

const PHASE_ORDER = STEPS.map((s) => s.phase);

function getStepStatus(stepPhase: AgentPhase, currentPhase: AgentPhase): "done" | "active" | "pending" {
  const stepIdx = PHASE_ORDER.indexOf(stepPhase);
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);

  if (currentPhase === "done") return "done";
  if (currentPhase === "error") {
    return stepIdx < currentIdx ? "done" : stepIdx === currentIdx ? "active" : "pending";
  }
  if (currentIdx < 0) return "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

const BuildSteps = ({ currentPhase }: Props) => {
  if (currentPhase === "idle") return null;

  return (
    <div className="px-1 py-2">
      <div className="flex flex-col gap-0.5">
        {STEPS.map((step) => {
          const status = getStepStatus(step.phase, currentPhase);
          return (
            <div
              key={step.phase}
              className={`flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors ${
                status === "active"
                  ? "bg-primary/10 text-primary font-medium"
                  : status === "done"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
              }`}
            >
              {status === "done" ? (
                <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              ) : status === "active" ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              ) : (
                <Circle className="h-3 w-3 shrink-0" />
              )}
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BuildSteps;
