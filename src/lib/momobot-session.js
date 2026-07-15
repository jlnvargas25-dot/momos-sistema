export const MOMOBOT_READ_ONLY_TURN_LIMIT = 4;

export function canAutoStartMomobot({
  permissionState,
  sessionActive = false,
  speechInProgress = false,
  hasDraft = false,
  authorizing = false,
} = {}) {
  return permissionState === "granted"
    && !sessionActive
    && !speechInProgress
    && !hasDraft
    && !authorizing;
}

export function momobotModeAfterReadOnly({
  handsFree = false,
  readOnlyTurns = 0,
  hasPendingDraft = false,
  draftCanExecute = false,
  turnLimit = MOMOBOT_READ_ONLY_TURN_LIMIT,
} = {}) {
  if (!handsFree) return "idle";
  if (readOnlyTurns >= turnLimit) return "standby";
  if (hasPendingDraft) return draftCanExecute ? "action" : "followup";
  return "followup";
}

export function isCurrentMomobotAuthorization(attempt, currentAttempt) {
  return Number.isInteger(attempt) && attempt === currentAttempt;
}

export function momobotModeAfterExecution({ handsFree = false, voiceAvailable = false, succeeded = false } = {}) {
  return succeeded && handsFree && voiceAvailable ? "dictation" : "standby";
}
