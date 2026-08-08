// BL-820: flag parsing for closing-ceremony-adjustment.js - the CLI the
// coordinator's own within-power powers (promotion order, throttle
// posture) go through when the ceremony packet shows something actionable.
// `--form`/`--ref` together are the reversibility record (human decision
// 7): a ticket id or a note pointer, never a silent edit.
import { parseFlagPairs } from './bounceArgsCore';
import { isKnownCeremonyAdjustmentKind, isKnownCeremonyRecordForm, isValidShiftKey, CeremonyAdjustmentKind, CeremonyRecordForm } from '../quality/closingCeremony';

export interface ClosingCeremonyAdjustmentArgs {
  shift: string;
  kind: CeremonyAdjustmentKind;
  detail: string;
  form: CeremonyRecordForm;
  ref: string;
  target?: string;
  at?: string;
}

const FLAG_NAMES = ['--shift', '--kind', '--detail', '--form', '--ref', '--target', '--at'] as const;

function isValidShiftAndKind(shift: string | undefined, kind: string | undefined): boolean {
  return isValidShiftKey(shift) && !!kind && isKnownCeremonyAdjustmentKind(kind);
}

function isValidDetailFormRef(detail: string | undefined, form: string | undefined, ref: string | undefined): boolean {
  if (!detail) {
    return false;
  }
  if (!form || !isKnownCeremonyRecordForm(form)) {
    return false;
  }
  return !!ref;
}

export function parseArgs(argv: string[]): ClosingCeremonyAdjustmentArgs | null {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  if (!flags) {
    return null;
  }
  const { '--shift': shift, '--kind': kind, '--detail': detail, '--form': form, '--ref': ref, '--target': target, '--at': at } = flags;
  if (!isValidShiftAndKind(shift, kind) || !isValidDetailFormRef(detail, form, ref)) {
    return null;
  }
  const args: ClosingCeremonyAdjustmentArgs = {
    shift: shift as string,
    kind: kind as CeremonyAdjustmentKind,
    detail: detail as string,
    form: form as CeremonyRecordForm,
    ref: ref as string,
  };
  if (target !== undefined) {
    args.target = target;
  }
  if (at !== undefined) {
    args.at = at;
  }
  return args;
}

export const USAGE =
  'Usage: closing-ceremony-adjustment.js --shift <yyyy-MM-dd> --kind <promotion_order|throttle_posture> --detail <text> --form <ticket|note> --ref <id> [--target <path>] [--at <iso-timestamp>]\n';
