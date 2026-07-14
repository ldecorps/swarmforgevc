import { hasReferenceSolution, materializeTaskFixture, overlayReferenceSolution } from './taskFixture';
import { QualityEvaluator, TaskSpec } from './types';

export interface TaskSoundnessResult {
  sound: boolean;
  reason?: string;
}

export interface TaskSoundnessDeps {
  evaluator: QualityEvaluator;
  scratchRoot: string;
}

// BL-386 acceptance scenario 05: a task whose OWN reference solution
// cannot pass its OWN tests would score every model at zero - the mirror
// image of the bug this epic exists to fix (a metric that discriminates
// nothing, this time by flooring instead of saturating). Refused BEFORE
// any model is run, so a broken fixture can never be mistaken for a
// finding about the models.
//
// A task with no `reference/` solution at all is left unvalidated (sound
// by default) rather than refused - opt-in, not mandatory, so a task
// fixture predating this ticket keeps working exactly as it always has
// (no reference/ directory means this check never even calls the
// evaluator, so it costs nothing to a caller that hasn't adopted it yet).
export async function checkTaskSoundness(task: TaskSpec, deps: TaskSoundnessDeps): Promise<TaskSoundnessResult> {
  if (!hasReferenceSolution(task)) {
    return { sound: true };
  }
  const materializedDir = materializeTaskFixture(task, deps.scratchRoot);
  overlayReferenceSolution(task, materializedDir);
  const { passed, total } = await deps.evaluator.evaluate(materializedDir, task);
  return total > 0 && passed === total
    ? { sound: true }
    : { sound: false, reason: `task ${task.id}'s own reference solution does not pass its tests (${passed}/${total})` };
}
